# Installing the Gen Con Planner desktop app

The desktop app is **not code-signed** — a paid Apple/Microsoft signing
certificate isn't worth it for a small hobby app. That's safe, but it means
your operating system shows a scary-looking warning the **first** time you
open the app. Here's how to get past it. You only do this **once** per install.

## macOS

1. Open the downloaded `.dmg`, drag **Gen Con Planner** into your
   **Applications** folder, then eject the disk image.
2. Double-clicking the app will say *"Gen Con Planner is damaged and can't be
   opened."* It is **not** damaged — that's just macOS's message for an app
   from an unregistered developer. To clear it:
   - Open the **Terminal** app (press ⌘-Space, type `Terminal`, press Return).
   - Copy this line **exactly**, paste it into Terminal, and press Return:
     ```
     xattr -dr com.apple.quarantine "/Applications/Gen Con Planner.app"
     ```
3. Now open **Gen Con Planner** from your Applications folder — it launches
   normally. You won't need to do any of this again.

## Windows

1. Run the downloaded `.exe` installer.
2. Windows SmartScreen shows a blue *"Windows protected your PC"* dialog.
   Click **"More info"**, then click the **"Run anyway"** button that appears.
3. The installer proceeds normally — no command line needed.

## Linux

1. Download the `.AppImage` file.
2. Make it executable, either:
   - right-click it → **Properties** → **Permissions** → tick **"Allow
     executing file as program"**, or
   - in a terminal: `chmod +x Gen-Con-Planner-*.AppImage`
3. Double-click it (or run it from the terminal).

---

**Why the warnings?** The app has no paid signing certificate, so macOS and
Windows can't automatically confirm who published it. The steps above just
tell your OS "yes, I trust this one." They don't disable real malware
protection — they only acknowledge an unsigned app from someone you know.
