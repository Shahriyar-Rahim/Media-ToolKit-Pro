# Media Toolkit Pro

**Modern offline desktop media processing and workflow management**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D%2018-brightgreen)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/electron-33.0+-blue)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/react-18.3+-61dafb)](https://react.dev/)
[![Vite](https://img.shields.io/badge/vite-5.4+-646cff)](https://vitejs.dev/)

<div align="center">
  <img src="build/icon.png" alt="Media Toolkit Pro" width="200" />
  <p><strong>Professional media management for desktop workflows</strong></p>
</div>

## Overview

Media Toolkit Pro is a comprehensive desktop application engineered for professionals who demand fast, reliable, and offline-capable media processing. Built with cutting-edge web technologies (React, Electron, Vite) and powered by industry-standard tools (FFmpeg, FFprobe), the platform provides a robust suite of media handling capabilities without cloud dependencies.

## ✨ Key Features

- 🖥️ **Native Desktop App** — Built with Electron for seamless cross-platform performance
- 📺 **Media Processing** — Integrated FFmpeg and FFprobe for video/audio manipulation
- 💾 **Offline-First** — Full functionality without internet connection
- 🗂️ **Smart Job Management** — Track, queue, and manage processing jobs
- 🔐 **Secure Vault** — Organize and protect sensitive media assets
- ⚙️ **Settings & Profiles** — User accounts with customizable preferences
- 📊 **Activity Dashboard** — Real-time job monitoring and status tracking
- 🎨 **Modern UI** — Built with React and Tailwind CSS for responsive design
- 📦 **Cross-Platform** — Windows, macOS, Linux support

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
git clone https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro.git
cd Media-ToolKit-Pro
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build:ui && npm run dist
```

## 📁 Project Structure

```
src/
├── pages/           # Application pages (Auth, Dashboard, Tools, Settings)
├── components/      # Reusable UI components
├── lib/             # Utilities (API, hooks, helpers)
├── App.jsx          # Main application container
├── main.jsx         # React entry point
└── index.css        # Global styles

electron/           # Electron main process
build/              # Build assets and icons
tests/              # Test suite
scripts/            # Build and utility scripts
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Tailwind CSS, Vite |
| **Desktop** | Electron 33 |
| **Media** | FFmpeg, FFprobe |
| **Database** | SQLite 3 |
| **Build** | Vite, Electron Builder |

## 📦 Available Scripts

```bash
npm run dev              # Start development server + Electron
npm run build:ui         # Build frontend with Vite
npm run start            # Launch packaged app
npm run dist             # Build distributable app
npm run test             # Run test suite
npm run smoke:electron   # Smoke test Electron build
npm run smoke:package    # Smoke test packaged app
```

## 🎯 Core Pages

- **Auth** — User authentication and account creation
- **Dashboard/Landing** — Main workspace and entry point
- **ToolPage** — Individual media tool interfaces
- **JobList** — Active and completed job tracking
- **Vault** — Asset organization and management
- **Settings** — App configuration and preferences
- **Pricing** — Subscription and feature tiers
- **Support** — Help, documentation, and support channels

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Write tests for new features
- Update documentation as needed
- Test on multiple platforms

## 📋 Requirements

### Runtime
- Node.js 18 or higher
- OS: Windows 10+, macOS 10.15+, Linux (Ubuntu 18.04+)

### Development
- Git
- npm or yarn
- Familiarity with React and Electron

## 🐛 Bug Reports & Feature Requests

Found an issue? Have a great idea? [Open an issue](https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/issues) on GitHub!

**Please include:**
- Clear description
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Screenshots if applicable
- System information

## 📄 License

This project is licensed under the MIT License — see the LICENSE file for details.

## 🙏 Acknowledgments

- [Electron](https://www.electronjs.org/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [FFmpeg](https://ffmpeg.org/)
- [SQLite](https://www.sqlite.org/)

## 📞 Support

Need help? Check out:

- [GitHub Issues](https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/issues)
- In-app Support page
- Settings and documentation

---

**Made with ❤️ by the Media Toolkit Pro team**
