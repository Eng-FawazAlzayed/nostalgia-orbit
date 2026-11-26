# Installing Nostalgia Orbit

Get the files from the repo's **Actions → apps** run (Artifacts section) or from **Releases**.

## Android phone, tablet, Android TV, Google TV
1. Copy `NostalgiaOrbit.apk` to the device (USB stick, or the "Send Files to TV" app, or download it from the Release page in a TV browser such as "Downloader").
2. Allow installs: Settings → Apps → Security (or "Install unknown apps") → allow the app you're opening the APK with.
3. Open the APK and install. On Google TV it appears in Apps with its own banner.
4. Remote: ▲▼ or CH± change channel, OK opens the channel list, digits type a channel number, Back closes menus.

## Windows
Run `Nostalgia Orbit_x.y.z_x64-setup.exe`. It uses the WebView2 runtime that ships with Windows 10/11
(the installer fetches it on older systems). F11 = fullscreen, Page Up/Down = channels, G = guide, S = setup.

## Samsung TV (Tizen, 2017–2019 models and newer)
Samsung TVs only accept apps signed for that exact TV. One-time setup on a Windows/Mac/Linux PC:
1. Install **Tizen Studio** with the "TV Extensions" and "Samsung Certificate Extension" packages (Package Manager).
2. On the TV: Apps → press 1 2 3 4 5 on the remote → Developer mode ON → enter your PC's IP → restart the TV.
3. In Tizen Studio: Device Manager → Scan → connect to the TV.
4. Certificate Manager → New → **Samsung** certificate → TV → sign in with a (free) Samsung account.
   When asked for device IDs, the connected TV's DUID is added automatically.
5. Sign and install the package from this repo:
   ```
   unzip NostalgiaOrbit-unsigned.wgt -d nostalgia
   tizen package -t wgt -s <your-certificate-profile> -- nostalgia
   tizen install -n nostalgia/NostalgiaOrbit.wgt -t <tv-name-from-device-manager>
   ```
6. The app shows up in the TV's Apps. Samsung remote: CH▲▼, number keys, GUIDE, INFO, PRE-CH, RED = CRT filter,
   YELLOW = channel names, BLUE = setup.

Developer-mode installs can expire after some time on some models; repeat step 5 if the app disappears.

## Web
Open `https://<you>.github.io/nostalgia-orbit/` in any browser. Good fallback for devices without an app.
