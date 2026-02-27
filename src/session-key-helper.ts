// ---------------------------------------------------------------------------
// OpenBrowserClaw — Session Key Helper (bookmarklet generator)
// ---------------------------------------------------------------------------
//
// Generates a bookmarklet that extracts the sessionKey cookie from claude.ai
// and redirects back to the app with the key in the URL hash.
// This enables a mobile-friendly login flow that doesn't require DevTools.

/**
 * Build a bookmarklet `javascript:` URL that, when run on claude.ai:
 * 1. Checks we're on the right domain
 * 2. Extracts the sessionKey from document.cookie
 * 3. Redirects back to the app's /settings page with #session_key=<value>
 *
 * If the cookie is HttpOnly and can't be read by JS, it falls back to
 * showing an alert with instructions.
 */
export function buildBookmarkletCode(appOrigin: string): string {
  // The bookmarklet JS — kept as a readable template, then minified.
  // We use single quotes inside to avoid escaping issues with the href attribute.
  const code = `
(function(){
  if(location.hostname!=='claude.ai'&&location.hostname!=='www.claude.ai'){
    alert('Please navigate to claude.ai first, then run this bookmarklet.');
    return;
  }
  var m=document.cookie.match(/(?:^|;\\s*)sessionKey=([^;]+)/);
  if(m&&m[1]){
    var k=m[1];
    var u='${appOrigin}/settings#session_key='+encodeURIComponent(k);
    if(confirm('Session key found! Tap OK to send it to OpenBrowserClaw.')){
      window.location=u;
    }
  }else{
    var msg='Could not read the session key cookie automatically.\\n\\n';
    msg+='The cookie may be marked HttpOnly. Try these alternatives:\\n\\n';
    msg+='1. Use the Console method: In your browser address bar, type:\\n';
    msg+='   javascript:void(prompt("Copy this:",document.cookie))\\n\\n';
    msg+='2. Check browser settings for cookie data.\\n\\n';
    msg+='3. On desktop, use DevTools > Application > Cookies.';
    alert(msg);
  }
})()
`.trim().replace(/\n\s*/g, '');

  return `javascript:${encodeURIComponent(code)}`;
}
