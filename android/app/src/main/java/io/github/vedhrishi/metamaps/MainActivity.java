package io.github.vedhrishi.metamaps;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.view.Gravity;
import android.util.TypedValue;

import androidx.core.content.FileProvider;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.media.AudioAttributes;
import android.media.AudioManager;
import java.util.Locale;
import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Meta Maps for Android: the live web app in a full-screen WebView, with the phone's location,
 * microphone, camera, share sheet and dialler wired up. All the product code is the website,
 * so updating the site updates the app.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://vedhrishi.github.io/meta-maps/";
    private static final int REQ_PERMS = 10, REQ_FILE = 11;

    private WebView web;
    private FrameLayout root;
    private PermissionRequest pendingWebPermission;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private TextToSpeech tts;
    private boolean ttsReady;
    private String ttsPending;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.parseColor("#050b18"));
        getWindow().setNavigationBarColor(Color.parseColor("#050b18"));
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#050b18"));
        // Android 15 draws apps edge to edge: keep the map clear of the status and navigation bars
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                top = i.top; bottom = i.bottom; left = i.left; right = i.right;
            } else {
                top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft(); right = insets.getSystemWindowInsetRight();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });

        try { web = new WebView(this); }
        catch (Throwable t) {
            TextView msg = label("Meta Maps needs Android System WebView.\nEnable or update it in Play Store, then reopen.", 16, "#ffffff", false, 0);
            msg.setPadding(48, 200, 48, 48);
            setContentView(msg);
            return;
        }
        web.setBackgroundColor(Color.parseColor("#050b18"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        darkBarsIconsLight();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " MetaMapsApp/1.0");

        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        initTts();
        web.addJavascriptInterface(new Bridge(), "MetaMapsApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state == null) showWelcome();
        requestStartupPermissions();

        if (state != null) web.restoreState(state);
        else web.loadUrl(startUrl(getIntent()));
    }

    /** Light icons on the dark bars. Must run after setContentView (the insets controller is null before it). */
    private void darkBarsIconsLight() {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                android.view.WindowInsetsController c = getWindow().getInsetsController();
                if (c != null) c.setSystemBarsAppearance(0,
                        android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            } else {
                View d = getWindow().getDecorView();
                d.setSystemUiVisibility(d.getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            }
        } catch (Throwable ignored) { /* cosmetic only */ }
    }

    /** Welcome card shown on every fresh launch: the creator's name inviting people in. */
    private void showWelcome() {
        final LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER);
        card.setBackgroundColor(Color.parseColor("#050b18"));
        int pad = (int) (32 * getResources().getDisplayMetrics().density);
        card.setPadding(pad, pad, pad, pad);
        card.setClickable(true);

        card.addView(label("Vedhrishi", 40, "#00d4ff", true, 0));
        card.addView(label("invites you to use", 18, "#9fb4cc", false, 10));
        card.addView(label("Meta Maps", 34, "#ffffff", true, 10));
        card.addView(label("Report road hazards. Drive around them.", 15, "#9fb4cc", false, 22));

        TextView go = label("Start", 18, "#050b18", true, 36);
        go.setBackgroundColor(Color.parseColor("#00d4ff"));
        int h = (int) (14 * getResources().getDisplayMetrics().density), w = (int) (44 * getResources().getDisplayMetrics().density);
        go.setPadding(w, h, w, h);
        card.addView(go);

        root.addView(card, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        final Runnable close = () -> {
            if (card.getParent() == null) return;
            card.animate().alpha(0f).setDuration(300).withEndAction(() -> root.removeView(card)).start();
        };
        go.setOnClickListener(v -> close.run());
        card.setOnClickListener(v -> close.run());
        card.postDelayed(close, 5000);
    }

    private TextView label(String t, int sp, String color, boolean bold, int topDp) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        v.setTextColor(Color.parseColor(color));
        v.setGravity(Gravity.CENTER);
        if (bold) v.setTypeface(v.getTypeface(), android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (topDp * getResources().getDisplayMetrics().density);
        v.setLayoutParams(lp);
        return v;
    }

    /** Meta's voice: Android's own text-to-speech (the WebView's built-in one is often silent). */
    private void initTts() {
        try {
            tts = new TextToSpeech(getApplicationContext(), status -> {
                if (status != TextToSpeech.SUCCESS || tts == null) return;
                int r = tts.setLanguage(new Locale("en", "IN"));
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(Locale.US);
                tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                tts.setSpeechRate(1.05f);
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { }
                    @Override public void onDone(String id) { ttsDone(); }
                    @Override public void onError(String id) { ttsDone(); }
                });
                ttsReady = true;
                if (ttsPending != null) { String t = ttsPending; ttsPending = null; sayNow(t); }
            });
        } catch (Throwable t) { tts = null; }
    }

    private void sayNow(String text) {
        if (tts == null) { ttsDone(); return; }
        if (!ttsReady) { ttsPending = text; return; }
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "mm") != TextToSpeech.SUCCESS) ttsDone();
    }

    /** Tell the page the voice finished, so it can start listening again. */
    private void ttsDone() {
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript("window.__mmTtsDone&&window.__mmTtsDone()", null); });
    }

    private String startUrl(Intent i) {
        Uri d = i != null ? i.getData() : null;
        if (d != null && "vedhrishi.github.io".equals(d.getHost()) && d.getPath() != null && d.getPath().startsWith("/meta-maps")) return d.toString();
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (web != null && intent.getData() != null) web.loadUrl(startUrl(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onPause() { if (web != null) web.onPause(); super.onPause(); }

    @Override
    protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
        if (web != null) { root.removeView(web); web.destroy(); }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    // ── permissions ──────────────────────────────────────────────────────────
    private boolean has(String p) { return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED; }

    private void requestStartupPermissions() {
        if (!has(Manifest.permission.ACCESS_FINE_LOCATION))
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (pendingGeo != null) {
            boolean ok = has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION);
            pendingGeo.invoke(pendingGeoOrigin, ok, false);
            pendingGeo = null;
        }
        if (pendingWebPermission != null) { grantWebPermission(pendingWebPermission); pendingWebPermission = null; }
    }

    /** Grant the web page the parts of a request the phone allows. */
    private void grantWebPermission(PermissionRequest r) {
        List<String> ok = new ArrayList<>();
        for (String res : r.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && has(Manifest.permission.RECORD_AUDIO)) ok.add(res);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && has(Manifest.permission.CAMERA)) ok.add(res);
        }
        if (ok.isEmpty()) r.deny(); else r.grant(ok.toArray(new String[0]));
    }

    // ── web client: keep our pages inside, send everything else to the right app ──
    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if (("https".equals(scheme) || "http".equals(scheme)) && "vedhrishi.github.io".equals(u.getHost())) return false;
            try {
                Intent i = new Intent("tel".equals(scheme) ? Intent.ACTION_DIAL : Intent.ACTION_VIEW, u);
                startActivity(i);
            } catch (ActivityNotFoundException ignored) { /* no app for it */ }
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) { injectShare(v); }

        @Override
        public void onPageFinished(WebView v, String url) { injectShare(v); }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            v.loadData("<html><body style='background:#050b18;color:#cfe8ff;font-family:sans-serif;text-align:center;padding:64px 24px'>"
                    + "<h2>No connection</h2><p>Meta Maps needs the internet the first time you open it.</p>"
                    + "<p><a style='color:#00d4ff' href='" + HOME + "'>Try again</a></p></body></html>", "text/html", "utf-8");
        }
    }

    /** WebView has no navigator.share; route it to the Android share sheet. */
    private void injectShare(WebView v) {
        v.evaluateJavascript("(function(){if(window.__mmShare)return;window.__mmShare=1;"
                + "navigator.share=function(d){d=d||{};try{MetaMapsApp.share(d.title||'',d.text||'',d.url||'');return Promise.resolve();}catch(e){return Promise.reject(e);}};"
                + "navigator.canShare=function(){return true;};})();", null);
    }

    private class Bridge {
        @JavascriptInterface
        public void speak(String text) { runOnUiThread(() -> sayNow(text)); }

        @JavascriptInterface
        public void stopSpeaking() { runOnUiThread(() -> { if (tts != null) tts.stop(); }); }

        @JavascriptInterface
        public void share(String title, String text, String url) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                i.putExtra(Intent.EXTRA_TEXT, (text == null || text.isEmpty() ? "" : text + "\n") + (url == null ? "" : url));
                startActivity(Intent.createChooser(i, title.isEmpty() ? "Share" : title));
            });
        }
    }

    // ── chrome client: location, microphone, camera, photo picker ───────────────
    private class Chrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                cb.invoke(origin, true, false);
            } else {
                pendingGeo = cb; pendingGeoOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERMS);
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest r) {
            runOnUiThread(() -> {
                List<String> need = new ArrayList<>();
                for (String res : r.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res) && !has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res) && !has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                }
                if (need.isEmpty()) grantWebPermission(r);
                else { pendingWebPermission = r; requestPermissions(need.toArray(new String[0]), REQ_PERMS); }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("image/*");
            List<Intent> extra = new ArrayList<>();
            if (has(Manifest.permission.CAMERA) || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                try {
                    File dir = new File(getCacheDir(), "photos"); dir.mkdirs();
                    File f = File.createTempFile("hazard_", ".jpg", dir);
                    cameraUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                    Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                    cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                    cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    extra.add(cam);
                } catch (Exception ignored) { cameraUri = null; }
            }
            Intent chooser = Intent.createChooser(pick, "Add a photo");
            if (!extra.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extra.toArray(new Intent[0]));
            try { startActivityForResult(chooser, REQ_FILE); }
            catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; return false; }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != REQ_FILE || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK) {
            if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (cameraUri != null) out = new Uri[]{cameraUri};
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
        cameraUri = null;
    }
}
