# 🎬 Media Toolkit Pro

[![GitHub Release](https://img.shields.io/github/v/release/Shahriyar-Rahim/Media-ToolKit-Pro?include_prereleases&style=for-the-badge)](https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Node.js Requirement](https://img.shields.io/badge/node-%3E%3D%2018-brightgreen?style=for-the-badge)](https://nodejs.org/)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=for-the-badge)]()
[![Platform Support](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-blue?style=for-the-badge)]()

<div align="center">

### **Professional Media Management for Desktop Workflows**

_Powerful offline-first desktop application for modern media processing, job orchestration, and asset management._

[🚀 Get Started](#quick-start) • [📖 Docs](#documentation) • [🤝 Contribute](#contributing) • [💬 Support](#support) • [📰 Changelog](#changelog)

![Dashboard Screenshot](docs/screenshots/dashboard.png)
![Tools Screenshot](docs/screenshots/tools.png)
![Job Manager Screenshot](docs/screenshots/jobs.png)

</div>

---

## ✨ Highlights

<table>
<tr>
<td>

### 🖥️ Native Desktop
Built with Electron and React for true native desktop experience across Windows, macOS, and Linux.

</td>
<td>

### 📺 Media Processing
Integrated FFmpeg and FFprobe for professional video/audio encoding, transcoding, and analysis.

</td>
</tr>
<tr>
<td>

### 💾 Offline-First
Full functionality without internet. Process media locally, securely, and with complete control.

</td>
<td>

### ⚡ Performance
Vite for lightning-fast frontend builds, Electron for responsive desktop performance.

</td>
</tr>
<tr>
<td>

### 🗂️ Smart Workflow
Job queuing, asset management, and user profiles for organized, repeatable workflows.

</td>
<td>

### 🔐 Secure
Local-first architecture with SQLite persistence. No cloud dependency, no data leaks.

</td>
</tr>
</table>

---

## 🎯 Features

### Core Capabilities

- ✅ **Offline Media Processing** — Process video and audio files without cloud services
- ✅ **Job Management** — Queue, track, and manage processing tasks
- ✅ **Asset Vault** — Organize and protect media files securely
- ✅ **User Accounts** — Multi-user support with individual profiles and settings
- ✅ **Dashboard** — Real-time activity monitoring and job status tracking
- ✅ **Settings & Preferences** — Customize app behavior and workflow
- ✅ **Cross-Platform** — Native apps for Windows, macOS, and Linux
- ✅ **Modern UI** — Built with React, Tailwind CSS, and responsive design
- ✅ **Extensible** — Modular architecture for custom integrations

### Technical Features

- Built-in SQLite database for local data persistence
- RESTful API for programmatic access
- Electron IPC for secure process communication
- Hot module reload in development
- Automated testing suite
- Packaged installers for all platforms

---

## 📊 Tech Stack

```
┌─────────────────────────────────────┐
│         Frontend Layer               │
│  React 18 • Tailwind CSS • Vite 5    │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│      Application Layer               │
│      Electron 33 Desktop Frame       │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│       System Layer                   │
│  FFmpeg • FFprobe • SQLite • Node    │
└─────────────────────────────────────┘
```

### Dependencies

| Category | Package | Version |
|----------|---------|----------|
| **Runtime** | electron | ^33.0.0 |
| | react | ^18.3.0 |
| | react-dom | ^18.3.0 |
| **Media** | ffmpeg-static | ^5.2.0 |
| | ffprobe-static | ^3.1.0 |
| **Database** | better-sqlite3 | ^11.0.0 |
| **Build** | vite | ^5.4.0 |
| | electron-builder | ^25.0.0 |
| **Styling** | tailwindcss | ^3.4.0 |
| **UI** | lucide-react | ^0.400.0 |

---

## 🚀 Quick Start

### System Requirements

```
✓ Node.js 18 or higher
✓ npm or yarn
✓ 500 MB free disk space
✓ 2 GB RAM (recommended)
✓ Windows 10+, macOS 10.15+, or Ubuntu 18.04+
```

### Installation

```bash
# Clone repository
git clone https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro.git
cd Media-ToolKit-Pro

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build & Package

```bash
# Build frontend
npm run build:ui

# Package for your platform
npm run dist
```

Packaged installers will be in the `release/` directory.

---

## 📁 Project Architecture

```
Media-ToolKit-Pro/
├── src/                          # Frontend source
│   ├── pages/                    # Page components
│   │   ├── Auth.jsx              # Authentication flow
│   │   ├── Dashboard/            # Main dashboard
│   │   ├── ToolPage.jsx          # Media tool interface
│   │   ├── JobList.jsx           # Job management
│   │   ├── Vault.jsx             # Asset management
│   │   ├── Settings.jsx          # User preferences
│   │   ├── Pricing.jsx           # Subscription tiers
│   │   └── Support.jsx           # Help & support
│   ├── components/               # Reusable UI components
│   │   └── ui.jsx                # UI component library
│   ├── lib/                      # Utilities & hooks
│   │   ├── api.js                # API client
│   │   ├── useJobs.js            # Job management hook
│   │   └── greeting.js           # Utility functions
│   ├── App.jsx                   # Main app router
│   ├── main.jsx                  # React entry point
│   └── index.css                 # Global styles
├── electron/                     # Electron main process
│   ├── main.js                   # App entry point
│   └── tests/                    # Electron tests
├── build/                        # Build configuration
│   ├── icons/                    # App icons
│   └── installer/                # Platform-specific installers
├── tests/                        # Test suite
├── scripts/                      # Build scripts
├── package.json                  # Project config
├── vite.config.mjs               # Vite config
├── tailwind.config.mjs           # Tailwind config
└── README.md                     # This file
```

---

## 📋 Available Commands

```bash
# Development
npm run dev                    # Start dev server + Electron
npm run build:ui              # Build React frontend
npm run start                 # Launch packaged app

# Testing
npm run test                  # Run test suite
npm run smoke:electron        # Smoke test Electron build
npm run smoke:package         # Test packaged app

# Production
npm run dist                  # Build distributable packages
npm run postinstall           # Install app dependencies

# Other
npm run pack                  # Pack without publishing
```

---

## 🎓 Usage Guide

### Getting Started

1. **Launch the app** and create/login to your account
2. **Explore the dashboard** to familiarize yourself
3. **Access tools** from the main menu
4. **Create a job** to start media processing
5. **Monitor progress** from the Job List

### Core Workflows

#### Video Encoding
1. Navigate to Tools → Video Encoder
2. Upload or select source file
3. Choose output format and settings
4. Submit job
5. Monitor from Job List

#### Asset Management
1. Go to Vault
2. Organize files into collections
3. Add metadata and tags
4. Search and filter assets

#### Job Scheduling
1. Create job from any tool
2. Configure processing parameters
3. Set priority and timing
4. Queue multiple jobs
5. View unified job dashboard

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### Developer Guide

See [CONTRIBUTING.md](docs/README_CONTRIBUTORS.md) for detailed guidelines:
- Setting up development environment
- Code style and conventions
- Testing requirements
- Commit message format
- Pull request process

### Areas for Contribution

- 🐛 **Bug Fixes** — Help us squash bugs
- ✨ **Features** — Propose and implement new tools
- 📚 **Documentation** — Improve guides and API docs
- 🧪 **Tests** — Expand test coverage
- 🎨 **UI/UX** — Enhance interface and usability
- 🌍 **Localization** — Add language support

---

## 🐛 Reporting Issues

Found a bug? [Open an issue](https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/issues)!

**Please include:**
- Clear, descriptive title
- Steps to reproduce
- Expected vs. actual behavior
- Screenshots/videos if applicable
- System info (OS, Node version, etc.)
- Error logs or stack traces

---

## 💬 Support

### Get Help

- 📖 [Documentation](docs/)
- 💬 [GitHub Discussions](https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/discussions)
- 🐛 [Issue Tracker](https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/issues)
- 📧 In-app Support page

### Community

- Star the project ⭐ if you find it useful
- Share with colleagues and networks
- Contribute code or documentation
- Provide feedback and suggestions

---

## 📦 Releases & Changelog

### Current Version: v0.1.0

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

### Installation Methods

- **GitHub Releases** — Direct download of installers
- **Snap** — Linux snap package (if published)
- **Homebrew** — macOS Homebrew (if published)
- **Windows Installer** — NSIS installer
- **From Source** — Clone and build locally

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) file for details.

### You are free to:
- ✅ Use commercially
- ✅ Modify and distribute
- ✅ Use privately
- ✅ Use in patents

### You must:
- ℹ️ Include license and copyright notice

---

## 🙏 Acknowledgments

Built with awesome open-source projects:

- [Electron](https://www.electronjs.org/) — Desktop framework
- [React](https://react.dev/) — UI library
- [Vite](https://vitejs.dev/) — Build tool
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS
- [FFmpeg](https://ffmpeg.org/) — Media processing
- [SQLite](https://www.sqlite.org/) — Database

---

## 🔗 Links

- **Repository** — https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro
- **Issues** — https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/issues
- **Discussions** — https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/discussions
- **Releases** — https://github.com/Shahriyar-Rahim/Media-ToolKit-Pro/releases

---

<div align="center">

**[⬆ back to top](#-media-toolkit-pro)**

Made with ❤️ by developers who care about great desktop tools.

</div>
