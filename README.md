# STL Viewer - React Three Fiber

A simple STL file viewer built with React Three Fiber.

## Features

- 🎨 Modern React + TypeScript + Vite setup
- 🎯 React Three Fiber for 3D rendering
- 📦 STL file loading and display
- 🎮 Orbit controls for navigation
- 🌐 Grid and floor plane
- 💡 Proper lighting setup
- 🎨 Clean, modern UI

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open your browser to the URL shown in the terminal (typically http://localhost:5173)

## Usage

1. Select an STL file from the dropdown menu
2. Use mouse to rotate (left click + drag), pan (right click + drag), and zoom (scroll)
3. The model will be automatically centered and scaled to fit

## Adding STL Files

Place your `.stl` files in the `/public/stl` directory, then update the `STL_FILES` array in `src/App.tsx`:

```typescript
const STL_FILES = ["your-file.stl", "another-file.stl"];
```

## Project Structure

```
meshlib-react-fe/
├── public/
│   └── stl/              # STL files directory
├── src/
│   ├── components/
│   │   ├── Scene.tsx     # 3D scene setup
│   │   ├── STLViewer.tsx # STL loader
│   │   └── FileSelector.tsx # UI dropdown
│   ├── App.tsx           # Main app
│   ├── main.tsx          # Entry point
│   └── index.css         # Styles
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Technologies

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **React Three Fiber** - React renderer for Three.js
- **@react-three/drei** - Useful helpers for R3F
- **Three.js** - 3D library
