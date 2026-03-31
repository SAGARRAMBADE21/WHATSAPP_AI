// build.js — esbuild BUNDLE mode for Docker production builds
// Bundles ALL local source into a single dist/index.js
// node_modules stay external (already in /app/node_modules)
// Uses ~20MB RAM vs ~900MB for tsc
const { build } = require('esbuild');

console.log('⚡ Building with esbuild (bundle mode)...');

build({
    entryPoints: ['src/index.ts'],   // single entry point
    outfile: 'dist/index.js',         // single output file
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    bundle: true,                     // bundle ALL local imports into one file
    packages: 'external',             // keep node_modules as external requires
    sourcemap: false,
    minify: false,
    logLevel: 'info',
}).then(() => {
    console.log('✅ Build complete! → dist/index.js');
}).catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
