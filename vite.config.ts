import { defineConfig, type Plugin, build as viteBuild } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';

const aliases = {
  '@': resolve(__dirname, 'src'),
  'react': 'preact/compat',
  'react-dom': 'preact/compat',
};

function copyExtensionFiles(): Plugin {
  return {
    name: 'copy-extension-files',
    async closeBundle() {
      // -- Build each entry as a self-contained IIFE --
      const entries: Record<string, string> = {
        'content-script': resolve(__dirname, 'src/content/content-script.ts'),
        'service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'popup': resolve(__dirname, 'src/popup/Popup.tsx'),
        'options': resolve(__dirname, 'src/options/Options.tsx'),
      };

      for (const [name, entry] of Object.entries(entries)) {
        await viteBuild({
          configFile: false,
          resolve: { alias: aliases },
          build: {
            outDir: resolve(__dirname, 'dist'),
            emptyOutDir: false,
            write: true,
            lib: {
              entry,
              name: `marginalia_${name.replace('-', '_')}`,
              formats: ['iife'],
              fileName: () => `${name}.js`,
            },
          },
        });
      }

      // -- Copy static files --
      const iconDir = resolve(__dirname, 'dist/icons');
      if (!existsSync(iconDir)) mkdirSync(iconDir, { recursive: true });
      for (const size of ['16', '48', '128']) {
        const src = resolve(__dirname, `src/assets/icons/icon-${size}.png`);
        const dst = resolve(iconDir, `icon-${size}.png`);
        if (existsSync(src)) copyFileSync(src, dst);
      }

      // -- Copy CSS --
      for (const name of ['popup', 'options']) {
        const src = resolve(__dirname, `src/${name}/${name}.css`);
        if (existsSync(src)) {
          copyFileSync(src, resolve(__dirname, `dist/${name}.css`));
        }
      }

      // -- Write HTML files --
      writeFileSync(resolve(__dirname, 'dist/popup.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Marginalia</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div id="popup-root"></div>
  <script src="popup.js"></script>
</body>
</html>`);

      writeFileSync(resolve(__dirname, 'dist/options.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Marginalia Settings</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <div id="options-root"></div>
  <script src="options.js"></script>
</body>
</html>`);

      // -- Write manifest --
      const manifest = {
        manifest_version: 3,
        name: 'Marginalia',
        description: 'AI-powered reading companion — contextual annotations for any web page',
        version: '0.1.0',
        permissions: ['activeTab', 'storage', 'tabs'],
        action: {
          default_popup: 'popup.html',
          default_icon: {
            '16': 'icons/icon-16.png',
            '48': 'icons/icon-48.png',
            '128': 'icons/icon-128.png',
          },
        },
        icons: {
          '16': 'icons/icon-16.png',
          '48': 'icons/icon-48.png',
          '128': 'icons/icon-128.png',
        },
        background: {
          service_worker: 'service-worker.js',
        },
        content_scripts: [{
          matches: ['<all_urls>'],
          js: ['content-script.js'],
        }],
        options_page: 'options.html',
      };

      writeFileSync(
        resolve(__dirname, 'dist/manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    },
  };
}

export default defineConfig({
  resolve: { alias: aliases },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Main build produces nothing — copyExtensionFiles does the real work
    rollupOptions: {
      input: resolve(__dirname, 'src/shared/types.ts'),
      output: { entryFileNames: 'noop.js' },
    },
  },
  plugins: [copyExtensionFiles()],
});
