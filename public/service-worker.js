// public/service-worker.js

// This event is fired when the service worker is installed for the first time.
// It's a good place to set up initial caching, but for now, we'll keep it simple.
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installed');
    // `self.skipWaiting()` forces the waiting service worker to become the active service worker.
    // This ensures that the new service worker takes control of the page immediately after installation.
    event.waitUntil(self.skipWaiting());
});

// This event is fired when the service worker is activated.
// It's useful for cleaning up old caches or performing other one-time setup.
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activated');
    // `self.clients.claim()` makes the current service worker control all clients
    // (i.e., your open browser tabs for this app) immediately after activation.
    event.waitUntil(self.clients.claim());
});

// This is the crucial event for receiving push notifications from your server.
self.addEventListener('push', (event) => {
    console.log('Service Worker: Push message received!');

    // Check if there's any data sent with the push message
    const data = event.data ? event.data.json() : {}; // Assuming the push payload is JSON

    // Extract title and body from the received data, or use defaults
    const title = data.title || 'New Chat Message';
    const options = {
        body: data.body || 'You have a new message in the chat.',
        icon: '/icons/icon-192x192.png', // This will be your app's icon for the notification
        badge: '/icons/badge.png',       // Optional: A small icon for notification tray on some OS
        data: {
            url: data.url || '/' // This is the URL the browser will open when the notification is clicked
        }
        // You can add more options here, like 'image' for a larger image, 'vibrate', 'actions' (buttons)
    };

    // Show the notification using the browser's Notification API
    // `event.waitUntil` ensures the service worker stays active until the notification is shown
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// This event is fired when the user clicks on a notification displayed by the service worker.
self.addEventListener('notificationclick', (event) => {
    console.log('Service Worker: Notification clicked!');
    event.notification.close(); // Close the notification after it's clicked

    const urlToOpen = event.notification.data.url || '/';

    // `event.waitUntil` ensures the service worker stays active until the window is opened/focused
    event.waitUntil(
        // Check if a client (browser window/tab) for this URL is already open
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                for (const client of windowClients) {
                    // If an existing tab matches the URL and is visible, focus it
                    if (client.url === urlToOpen && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If no matching tab is found, open a new one
                return self.clients.openWindow(urlToOpen);
            })
    );
});