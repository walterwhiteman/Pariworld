// src/pages/_document.tsx
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* This links your web app manifest */}
        <link rel="manifest" href="/manifest.json" />
        {/* These are optional but good for iOS "Add to Home Screen" */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="PariChat" />
        {/* You can also specify an iOS specific icon, but the manifest typically handles it */}
        {/* <link rel="apple-touch-icon" href="/icons/icon-192x192.png" /> */}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
