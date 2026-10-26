package uz.polygraph.crm

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Обёртка над веб-версией CRM: открывает прод-адрес на весь экран.
 * Фронт обновляется на сервере — пересобирать приложение не нужно.
 */
class MainActivity : ComponentActivity() {

    private val crmUri: Uri = Uri.parse(BuildConfig.CRM_URL)

    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var offlineView: View

    /** Адрес открытой страницы — мост кэша отвечает только своему домену. */
    @Volatile private var pageUrl: String? = null

    /**
     * Старый WebView не отдаёт странице env(safe-area-inset-*) — тогда сами отступаем
     * под системные панели, иначе шапка CRM уедет под статус-бар.
     */
    private var padTop = false
    private var padBottom = false
    private var systemBars = Insets.NONE

    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Нельзя сделать скриншот или запись экрана, превью в списке приложений скрыто.
        // В debug-сборке снято, чтобы проверять вёрстку скриншотами.
        if (!BuildConfig.DEBUG) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()

        val root = FrameLayout(this)
        webView = createWebView()
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            visibility = View.GONE
        }
        offlineView = createOfflineView()
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(offlineView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(progressBar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))
        setContentView(root)

        // CRM рисуется на весь экран и сама отступает под статус-бар и нижнюю панель
        // (viewport-fit=cover + env(safe-area-inset-*) во фронте). Здесь — только клавиатура.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            systemBars = bars
            v.setPadding(
                if (padTop) bars.left else 0,
                if (padTop) bars.top else 0,
                if (padTop) bars.right else 0,
                maxOf(if (padBottom) bars.bottom else 0, ime.bottom),
            )
            progressBar.translationY = if (padTop) 0f else bars.top.toFloat()
            insets
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(BuildConfig.CRM_URL)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView = WebView(this).apply {
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            builtInZoomControls = false
            // Фронт сможет понять, что открыт в приложении.
            userAgentString = "$userAgentString PolygraphCRMApp/${BuildConfig.VERSION_NAME}"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        addJavascriptInterface(
            EncryptedCache(context) { pageUrl?.let { isCrmUrl(Uri.parse(it)) } == true },
            "PolygraphNative",
        )

        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isCrmUrl(uri)) return false
                openExternally(uri)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                pageUrl = url
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView, url: String?) {
                progressBar.visibility = View.GONE
                checkSafeAreaSupport()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    progressBar.visibility = View.GONE
                    offlineView.visibility = View.VISIBLE
                }
            }
        }

        webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback
                return try {
                    pickFiles.launch(fileChooserParams.createIntent())
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    private fun checkSafeAreaSupport() {
        if ((padTop || systemBars.top == 0) && (padBottom || systemBars.bottom == 0)) return
        val probe = "(function(){var d=document.createElement('div');" +
            "d.style.cssText='position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)';" +
            "document.documentElement.appendChild(d);var c=getComputedStyle(d);" +
            "var r=(parseFloat(c.paddingTop)||0)+','+(parseFloat(c.paddingBottom)||0);d.remove();return r;})()"
        webView.evaluateJavascript(probe) { result ->
            val (top, bottom) = result.trim('"').split(',').map { it.toFloatOrNull() ?: 0f } + listOf(0f, 0f)
            val newTop = padTop || (systemBars.top > 0 && top == 0f)
            val newBottom = padBottom || (systemBars.bottom > 0 && bottom == 0f)
            if (newTop != padTop || newBottom != padBottom) {
                padTop = newTop
                padBottom = newBottom
                ViewCompat.requestApplyInsets(webView.rootView)
            }
        }
    }

    private fun createOfflineView(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(0xFFFFFFFF.toInt())
        visibility = View.GONE
        addView(TextView(context).apply {
            setText(R.string.offline)
            textSize = 18f
            gravity = Gravity.CENTER
        })
        addView(Button(context).apply {
            setText(R.string.retry)
            setOnClickListener {
                offlineView.visibility = View.GONE
                webView.reload()
            }
        })
    }

    /** Свой домен и его поддомены открываем внутри, всё остальное — в системе. */
    private fun isCrmUrl(uri: Uri): Boolean {
        if (uri.scheme != "https") return false
        val host = uri.host ?: return false
        val base = crmUri.host?.removePrefix("www.") ?: return false
        return host == base || host.endsWith(".$base")
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
        }
    }
}
