# Project Ledger — Firebase version

Same tracker, backed by Firebase: Firestore for storage, Anonymous Auth so your
data is private to your device/browser, Firebase Hosting to put it on a real URL.
No custom backend server needed — the browser talks to Firestore directly.

Bonus over the plain Node version: Firestore pushes live updates, so if you have
the app open on two devices signed in the same way, changes appear on both
without a manual refresh — **once you're signed in the same way on both**, see
the note on syncing across devices below.

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Give it a name, and you can disable Google Analytics for this (not needed).
3. Once created, click the **</>** (web) icon to register a web app. Give it a nickname.
   You don't need Firebase Hosting checked at this step — you'll set that up via the CLI shortly.
4. Firebase shows you a `firebaseConfig` object — copy it, you'll need it in step 3 below.

## 2. Turn on Firestore and Anonymous Auth

In the Firebase Console for your project:

1. **Build → Firestore Database → Create database.** Start in **production mode**
   (the security rules in this repo lock it down properly, so production mode is fine).
   Pick any region close to you.
2. **Build → Authentication → Get started.** Under **Sign-in method**, enable
   **Anonymous**. This is what lets the app quietly sign you in without a login
   screen, while still keeping your data private to your device.

## 3. Configure the app with your project's keys

```bash
cd public
cp firebase-config.example.js firebase-config.js
```

Open `public/firebase-config.js` and paste in the `firebaseConfig` values from
step 1.4. This file is gitignored — your keys won't get committed. (Note: these
are not secret keys in the traditional sense — they're safe to expose in a
client app — but keeping them out of git keeps your repo generic and reusable.)

## 4. Install the Firebase CLI and deploy

```bash
npm install -g firebase-tools
firebase login
```

From the project root (where `firebase.json` lives):

```bash
firebase use --add
# Pick your project from the list, give it an alias like "default"

firebase deploy
```

This deploys both your Firestore security rules and the `public/` folder to
Firebase Hosting. The CLI prints a URL like `https://your-project.web.app` —
that's your live app, reachable from any device.

## Running it locally first (optional but recommended)

```bash
firebase emulators:start --only hosting
```

Opens the app at `http://localhost:5000`, still talking to your **real**
Firestore (not an emulated one) unless you also add the Firestore emulator —
fine for just checking the UI works before deploying.

## Using it across devices

Because sign-in is anonymous, "your data" is tied to a random anonymous user ID
that Firebase creates **per browser**, not per person. That means:

- Opening the deployed URL on your phone will create a **separate** anonymous
  identity from your laptop, with its own empty ledger — not the same data.
- To actually share the *same* data across devices, swap Anonymous auth for a
  real sign-in method (Google is easiest — a few lines of code and one more
  toggle in the Auth console). Say the word and I'll wire that in; it's a small
  change since the Firestore rules already key everything off `request.auth.uid`.

## Data model

Everything for one user lives in a single Firestore document:

```
users/{uid}/tracker/data
  └── projects: [
        { id, name, color: { bg, ring }, createdAt,
          tasks: [ { id, text, status, createdAt }, ... ] },
        ...
      ]
```

Simple on purpose — one document, one read, one write, matches how the original
Claude artifact stored things. If your task lists get very large (hundreds of
tasks per project) this would be worth splitting into subcollections, but for
personal use it's not necessary.

## Security rules

`firestore.rules` restricts every read/write to documents under the signed-in
user's own `uid` — nobody else can read or write your data, including other
anonymous users.

## Project structure

```
project-tracker-firebase/
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
└── public/
    ├── index.html
    ├── style.css
    ├── app.js                       # talks to Firestore directly
    ├── firebase-config.example.js   # template — copy to firebase-config.js
    └── firebase-config.js           # your keys (gitignored, you create this)
```
