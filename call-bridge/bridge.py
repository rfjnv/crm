"""
Мост звонков РОП-агента: отдельный аккаунт Telegram принимает обычные звонки
от директора и админа и соединяет их с голосовым агентом ElevenLabs.

Звук из звонка (48 кГц, моно) уходит агенту в его формате (обычно 16 кГц),
ответ агента возвращается в звонок кадрами по 10 мс. Кто может звонить, решает
CRM (POST /api/public/rop-call/bridge-session): остальным звонок сбрасывается.

Переменные окружения:
  TG_API_ID, TG_API_HASH  — ключ приложения с my.telegram.org
  TG_SESSION              — строка сессии аккаунта (login.py)
  CRM_BACKEND_URL         — адрес бэкенда CRM, например https://crm-backend-xxxx.onrender.com
  ROP_CALL_BRIDGE_SECRET  — тот же секрет, что у бэкенда
"""

import asyncio
import base64
import json
import logging
import os
import time

import aiohttp
from telethon import TelegramClient
from telethon.sessions import StringSession

from pytgcalls import PyTgCalls
from pytgcalls import filters as fl
from pytgcalls.types import ChatUpdate
from pytgcalls.types import Device
from pytgcalls.types import Direction
from pytgcalls.types import ExternalMedia
from pytgcalls.types import MediaStream
from pytgcalls.types import RecordStream
from pytgcalls.types import StreamFrames
from pytgcalls.types.raw import AudioParameters

from audio import pcm_rate, resample

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('call-bridge')

API_ID = int(os.environ['TG_API_ID'])
API_HASH = os.environ['TG_API_HASH']
SESSION = os.environ['TG_SESSION']
BACKEND = os.environ['CRM_BACKEND_URL'].rstrip('/')
SECRET = os.environ['ROP_CALL_BRIDGE_SECRET']

RATE = 48000                       # звук звонка
FRAME_SAMPLES = RATE // 100        # 10 мс
FRAME_BYTES = FRAME_SAMPLES * 2    # 16 бит, моно
SEND_EVERY_BYTES = FRAME_BYTES * 10  # агенту — пачками по 100 мс
AUDIO = AudioParameters(bitrate=RATE, channels=1)
SILENCE = bytes(FRAME_BYTES)

# Telethon привязывается к циклу событий при создании — создаём его заранее.
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
client = TelegramClient(StringSession(SESSION), API_ID, API_HASH)
calls_py = PyTgCalls(client)
http: aiohttp.ClientSession | None = None


class Call:
    """Один звонок: WebSocket агента, буферы звука и фоновые задачи."""

    def __init__(self, user_id: int, ws: aiohttp.ClientWebSocketResponse):
        self.user_id = user_id
        self.ws = ws
        self.agent_in_rate = 16000   # что агент принимает (уточняется в metadata)
        self.agent_out_rate = 16000  # что агент присылает
        self.to_agent = bytearray()  # 48 кГц из звонка
        self.to_call = bytearray()   # 48 кГц в звонок
        self.tasks: list[asyncio.Task] = []
        self.closed = False

    async def send_user_audio(self, pcm48: bytes) -> None:
        self.to_agent += pcm48
        if len(self.to_agent) < SEND_EVERY_BYTES or self.ws.closed:
            return
        chunk = bytes(self.to_agent)
        self.to_agent.clear()
        data = resample(chunk, RATE, self.agent_in_rate)
        await self.ws.send_json({'user_audio_chunk': base64.b64encode(data).decode()})

    async def read_agent(self) -> None:
        """События агента: звук — в буфер звонка, перебивание — очистить буфер."""
        async for msg in self.ws:
            if msg.type != aiohttp.WSMsgType.TEXT:
                continue
            ev = json.loads(msg.data)
            kind = ev.get('type')
            if kind == 'audio':
                pcm = base64.b64decode(ev['audio_event']['audio_base_64'])
                self.to_call += resample(pcm, self.agent_out_rate, RATE)
            elif kind == 'interruption':
                self.to_call.clear()
            elif kind == 'ping':
                p = ev.get('ping_event', {})
                await asyncio.sleep((p.get('ping_ms') or 0) / 1000)
                await self.ws.send_json({'type': 'pong', 'event_id': p.get('event_id')})
            elif kind == 'conversation_initiation_metadata':
                meta = ev.get('conversation_initiation_metadata_event', {})
                self.agent_out_rate = pcm_rate(meta.get('agent_output_audio_format'), self.agent_out_rate)
                self.agent_in_rate = pcm_rate(meta.get('user_input_audio_format'), self.agent_in_rate)
                log.info('call %s: conversation %s, in %s, out %s', self.user_id,
                         meta.get('conversation_id'), self.agent_in_rate, self.agent_out_rate)
            elif kind == 'user_transcript':
                log.info('call %s user: %s', self.user_id, ev.get('user_transcription_event', {}).get('user_transcript'))
            elif kind == 'agent_response':
                log.info('call %s agent: %s', self.user_id, ev.get('agent_response_event', {}).get('agent_response'))
        # Агент завершил разговор (попрощался, лимит времени): звук приходит быстрее, чем
        # играет, — сначала доигрываем прощание (не дольше 15 с), потом кладём трубку.
        log.info('call %s: agent closed the conversation (%s)', self.user_id, self.ws.close_code)
        deadline = time.monotonic() + 15
        while self.to_call and not self.closed and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        await hang_up(self.user_id)

    async def play_to_call(self) -> None:
        """Каждые 10 мс — кадр в звонок (тишина, пока агент молчит)."""
        start = time.monotonic()
        n = 0
        while not self.closed:
            if len(self.to_call) >= FRAME_BYTES:
                frame = bytes(self.to_call[:FRAME_BYTES])
                del self.to_call[:FRAME_BYTES]
            else:
                frame = SILENCE
            try:
                await calls_py.send_frame(self.user_id, Device.MICROPHONE, frame)
            except Exception as e:  # звонок уже закрыт
                log.debug('send_frame: %s', e)
            n += 1
            await asyncio.sleep(max(0.0, start + n * 0.01 - time.monotonic()))

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        # Закрытие может прийти из самой задачи чтения (агент положил трубку) — её не отменяем.
        current = asyncio.current_task()
        for t in self.tasks:
            if t is not current:
                t.cancel()
        if not self.ws.closed:
            await self.ws.close()


calls: dict[int, Call] = {}


async def bridge_session(user_id: int) -> dict | None:
    """Спросить CRM: можно ли этому человеку звонить, и получить адрес агента."""
    assert http is not None
    async with http.post(
        f'{BACKEND}/api/public/rop-call/bridge-session',
        json={'telegramId': str(user_id)},
        headers={'x-bridge-secret': SECRET},
        timeout=aiohttp.ClientTimeout(total=30),
    ) as r:
        if r.status in (401, 403):
            log.warning('call from %s refused by CRM: %s', user_id, await r.text())
            return None
        r.raise_for_status()
        return await r.json()


async def hang_up(user_id: int) -> None:
    call = calls.pop(user_id, None)
    if call:
        await call.close()
    try:
        await calls_py.leave_call(user_id)
    except Exception:
        pass


@calls_py.on_update(fl.chat_update(ChatUpdate.Status.INCOMING_CALL))
async def on_incoming(_: PyTgCalls, update: ChatUpdate) -> None:
    user_id = update.chat_id
    if user_id in calls:
        return
    log.info('incoming call from %s', user_id)
    try:
        session = await bridge_session(user_id)
    except Exception as e:
        log.error('CRM unavailable: %s', e)
        session = None
    if not session:
        await hang_up(user_id)
        return

    assert http is not None
    try:
        ws = await http.ws_connect(session['signedUrl'], heartbeat=None, max_msg_size=0)
        await ws.send_json({
            'type': 'conversation_initiation_client_data',
            'dynamic_variables': session['dynamicVariables'],
        })
        call = Call(user_id, ws)
        calls[user_id] = call
        # play — отвечает на звонок и открывает «микрофон» для кадров агента; record — слышим звонящего.
        await calls_py.play(user_id, MediaStream(ExternalMedia.AUDIO, AUDIO))
        await calls_py.record(user_id, RecordStream(True, AUDIO))
        call.tasks = [asyncio.create_task(call.read_agent()), asyncio.create_task(call.play_to_call())]
        log.info('call %s connected (%s)', user_id, session.get('userName'))
    except Exception:
        log.exception('call %s: failed to connect', user_id)
        await hang_up(user_id)


@calls_py.on_update(fl.chat_update(ChatUpdate.Status.LEFT_CALL))
async def on_left(_: PyTgCalls, update: ChatUpdate) -> None:
    if update.chat_id in calls:
        log.info('call %s ended by caller', update.chat_id)
        call = calls.pop(update.chat_id)
        await call.close()


@calls_py.on_update(fl.stream_frame(Direction.INCOMING, Device.MICROPHONE))
async def on_frames(_: PyTgCalls, update: StreamFrames) -> None:
    call = calls.get(update.chat_id)
    if not call or not update.frames:
        return
    try:
        await call.send_user_audio(update.frames[0].frame)
    except Exception as e:
        log.warning('call %s: send to agent failed: %s', update.chat_id, e)


async def main() -> None:
    global http
    http = aiohttp.ClientSession()
    await calls_py.start()
    me = await client.get_me()
    log.info('call bridge is up as @%s (%s)', me.username, me.id)
    await client.run_until_disconnected()


if __name__ == '__main__':
    loop.run_until_complete(main())
