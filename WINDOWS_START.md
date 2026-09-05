# VIGNETTE - AI Video Creation Studio

## Quick Start for Windows 11

### Prerequisites
Your system has been audited and meets all requirements:
- ✅ Windows 11 Pro (64-bit)
- ✅ Node.js v24.19.0
- ✅ Python 3.13.15
- ✅ FFmpeg 9.0
- ✅ NVIDIA GeForce RTX 3060 (4GB VRAM)
- ✅ 64GB RAM
- ✅ 687GB free disk space

### Installation & Launch

**Option 1: Double-click `start.bat`**
1. Navigate to the `vignette` folder
2. Double-click `start.bat`
3. The script will automatically install dependencies if needed and start the app

**Option 2: Command Line**
```powershell
cd vignette
npm install
npm run dev
```

The application will open automatically in your default browser at `http://localhost:5173/`

---

## Application Structure

### 6 Main Tabs:

1. **CATALOG** - Import and prepare raw media assets
   - Drag-and-drop image/audio files
   - Automatic proxy generation
   - Aspect ratio selection (9:16 or 16:9)

2. **GROUPS** - Organize media into narrative clusters
   - AI-powered image clustering
   - Manual regrouping tools
   - Visual style presets

3. **SCRIPT** - Generate Edit Decision List (EDL)
   - AI transition scripting
   - Timeline adjustment
   - Environmental typography

4. **AUDIO** - Synthesize narration and mix audio
   - Neural voice personas
   - Background music selection
   - Dynamic audio ducking

5. **PREVIEW** - Review and export
   - Low-quality preview render
   - Export settings (720p/1080p/4K, 24/30/60 FPS)
   - Multiple codec support (H.264, H.265)

6. **PROJECT** - Manage settings and configurations
   - Save/load projects
   - Auto-pilot vs Step-by-step modes
   - System resource monitoring

---

## Workflow

```
CATALOG → GROUPS → SCRIPT → AUDIO → PREVIEW
    ↑                              ↓
    └────────── PROJECT ───────────┘
```

Progress linearly through the first 5 tabs, with PROJECT available globally for settings and project management.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save project |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Space`  | Play/Pause preview |
| `←/→`    | Frame-by-frame scrubbing |

---

## Troubleshooting

### Port Already in Use
If port 5173 is already in use, the app will automatically try the next available port.

### Dependencies Issues
Delete `node_modules` folder and run:
```powershell
npm install
```

### GPU Memory Issues
Monitor VRAM usage in the PROJECT tab. Reduce resolution or close other GPU-intensive applications if needed.

---

## Technical Details

- **Frontend**: React + TypeScript + Vite
- **State Management**: Zustand
- **AI Inference**: WebGPU / Local API
- **Video Processing**: FFmpeg.wasm
- **Audio Processing**: Web Audio API

---

## License

MIT License - See LICENSE file for details

---

**Enjoy creating with VIGNETTE! 🎬**
