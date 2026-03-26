# Build instructions for Polished Chrome Extension

## 1. Install dependencies

```
npm install
```

## 2. Build TypeScript

```
npm run build
```
- This will compile all `.ts` files to `dist/` and copy the resulting `.js` files to the extension root for Chrome to load.

## 3. Load in Chrome
- Go to `chrome://extensions`
- Enable Developer Mode
- Click "Load unpacked" and select the `extension/` folder

## 4. Develop
- Edit `.ts` files as needed
- Re-run `npm run build` after changes

## Notes
- Only the compiled `.js` files are loaded by Chrome (not `.ts`)
- You can add more scripts or use a bundler for advanced needs
