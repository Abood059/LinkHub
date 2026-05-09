# LinkHub – Android Device Manager

![Status](https://img.shields.io/badge/status-active-informational)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Tech](https://img.shields.io/badge/tech-Node.js%20%7C%20Electron-brightgreen)
![Role](https://img.shields.io/badge/role-Team%20Lead%20%26%20System%20Architect-blueviolet)

> A cross-platform desktop application for managing Android devices locally via ADB with intelligent screen mirroring and smart download management.

**Project Status:** Active development • **Team:** 5 members • **My Role:** Team Lead & Full-Stack Engineer

---

## Overview

LinkHub is an Electron-based desktop application that provides unified management for Android devices connected via USB or wireless (ADB over TCP/IP). It combines device discovery, pairing, screen mirroring, and intelligent file downloading into a single interface.

### Core Capabilities

- **Device Discovery:** Automatically detects connected Android devices via USB and Bonjour service scanning
- **Wireless Pairing:** Support for `adb pair` and `adb connect` protocols for LAN connectivity
- **Screen Mirroring:** Low-latency display streaming using Scrcpy with dynamic quality adjustment
- **Smart Download Manager:** Inspects URLs, extracts direct download links, and manages transfers
- **Device Persistence:** Stores paired devices in SQLite for quick reconnection
- **Error Tracking:** Centralized error reporting and process logging

## Quick Start

```bash
# Clone and install
git clone https://github.com/Abood059/LinkHub.git
cd LinkHub
npm install

# First-time setup (required)
# 1. Enable USB Debugging on your Android device: Settings > Developer Options > USB Debugging
# 2. Connect device via USB cable
# 3. Grant USB permissions when prompted

# Start the application
npm start
```

### Requirements

- **Node.js** v16+
- **OS:** Windows or Linux
- **Android device:** v8.0+ with USB debugging enabled
- **Network:** Local LAN for wireless connection after initial pairing

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Electron 40, HTML/CSS/JavaScript |
| **Backend** | Node.js, Express (optional) |
| **Device Communication** | ADB (USB + TCP/IP), Bonjour service discovery |
| **Screen Mirroring** | Scrcpy |
| **Data Persistence** | SQLite3 |
| **HTTP Client** | Axios |

---

## Architecture

```
┌─────────────────────────────────────────┐
│       LinkHub Electron Frontend         │
│       (Renderer Process - UI)           │
└──────────────┬──────────────────────────┘
               │ IPC
┌──────────────▼──────────────────────────┐
│    Main Process (Node.js Backend)       │
├─────────────────────────────────────────┤
│  Controllers:                           │
│  • DeviceInteractionController          │
│  • StreamingController                  │
│  • StartupController                    │
├─────────────────────────────────────────┤
│  Services:                              │
│  • ConnectionService (ADB + Bonjour)    │
│  • ScrcpyService (Screen mirroring)     │
│  • ProcessManager (Child process mgmt)  │
│  • DatabaseManager (SQLite)             │
│  • DownloadService (Smart downloads)    │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┬──────────┐
        ▼             ▼          ▼
   [Android       [Scrcpy]   [SQLite]
    Devices]      [Binary]   [Database]
```

---

## Key Features

✅ **USB Device Detection** – Real-time scanning via `adb devices`  
✅ **Wireless Pairing** – ADB-over-TCP/IP with seamless reconnection  
✅ **Screen Mirroring** – Quality-adaptive Scrcpy streaming  
✅ **Persistent Storage** – SQLite database for device history  
✅ **Link Inspector** – Intelligent URL analysis and direct-link extraction  
✅ **Error Recovery** – Automatic cleanup and graceful error handling  

---

## My Role & Contribution

As **Team Lead and System Architect**, I designed and implemented:

1. **System Architecture** – End-to-end architecture for device communication, UI orchestration, and data flow
2. **ADB Integration** – Built the complete wireless pairing and connection layer using ADB-over-TCP/IP + SSH tunneling
3. **Screen Mirroring** – Integrated and customized Scrcpy for low-latency wireless streaming
4. **Process Management** – Designed robust process lifecycle management with log buffering
5. **Database Schema** – SQLite design for device persistence and audit logging
6. **Team Coordination** – Provided detailed specifications for parallel feature development

---

## Project Structure

```
LinkHub/
├── src/main/
│   ├── controllers/          # Business logic layer
│   ├── handlers/             # IPC bridge (Electron ↔ Renderer)
│   ├── models/               # Data structures
│   ├── services/             # Core services (ADB, Scrcpy, DB)
│   └── index.js              # Electron entry point
├── src/renderer/             # UI frontend
├── resources/bin/            # ADB & Scrcpy binaries
├── data/                     # SQLite database
└── package.json
```

For detailed architecture documentation, see [DETAILS.md](./DETAILS.md).

---

## Development Status

| Component | Status | Notes |
|-----------|--------|-------|
| USB Device Detection | ✅ Complete | Active ADB watcher |
| Wireless Pairing | ✅ Complete | Bonjour + ADB pair protocol |
| Screen Mirroring | ✅ Complete | Adaptive bitrate (4M/8M) |
| Download Manager | ✅ Complete | Link inspection + direct-link extraction |
| Device Persistence | ✅ Complete | SQLite with migration support |
| Error Handling | ✅ Complete | Centralized error service |

---

## Known Limitations

- **First connection** requires USB cable to grant ADB permissions
- **Network dependent** – Devices must be on same local network (LAN)
- **Android only** – iOS not supported
- **Performance varies** with Wi-Fi signal strength and device CPU

---

## Testing

```bash
# Run unit tests
npm test

# Build for distribution
npm run dist:linux    # Linux
npm run dist:win      # Windows
```

---

## Connect & Contribute

- **GitHub:** [@Abood059](https://github.com/Abood059)
- **Project:** [github.com/Abood059/LinkHub](https://github.com/Abood059/LinkHub)
- **Issues:** Use GitHub Issues for bugs and feature requests

---

## License

This project is part of a graduation thesis (Islamic University of Gaza, May 2026).  
Code availability: Available after final submission.

*Last Updated: May 2026*
