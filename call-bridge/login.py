"""
Вход в аккаунт РОП-агента — запускаете у себя один раз.

    pip install telethon
    python login.py

Спросит API ID и API Hash (my.telegram.org → API development tools), номер телефона
аккаунта и код из Telegram. В конце напечатает строку сессии — её нужно вставить
в Render в переменную TG_SESSION сервиса rop-call-bridge.

Строка сессии = полный доступ к аккаунту. Никому её не пересылайте, только в Render.
"""

from telethon.sync import TelegramClient
from telethon.sessions import StringSession

api_id = int(input('API ID: ').strip())
api_hash = input('API Hash: ').strip()

with TelegramClient(StringSession(), api_id, api_hash) as client:
    me = client.get_me()
    print(f'\nВошли как {me.first_name} (@{me.username}), id {me.id}')
    print('\nСтрока сессии для TG_SESSION (скопируйте целиком):\n')
    print(client.session.save())
