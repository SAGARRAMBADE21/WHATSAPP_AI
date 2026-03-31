// build.js — replaces `tsc` for Docker production builds
// Uses esbuild: ~20MB RAM vs ~900MB for tsc
const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

function getTypeScriptFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...getTypeScriptFiles(fullPath));
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

const entryPoints = getTypeScriptFiles('src');
console.log(`Building ${entryPoints.length} TypeScript files with esbuild...`);

build({
    entryPoints,
    outbase: 'src',
    outdir: 'dist',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: false,
    minify: false,
    bundle: false,         // preserve file structure, like tsc
    logLevel: 'info',
}).then(() => {
    console.log('✅ Build complete!');
}).catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
