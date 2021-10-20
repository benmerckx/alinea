import {spawn} from 'child_process'
import esbuild from 'esbuild'
import alias from 'esbuild-plugin-alias'
import {ScssModulesPlugin} from 'esbuild-scss-modules-plugin'
import fs from 'fs'
import {createServer, request} from 'http'
import {createRequire} from 'module'
import path from 'path'

const require = createRequire(import.meta.url)
const usePreact = true
const clients = []

/*
These should be resolved using the conditional exports, but before building
those are not available so we point at the source directly.
*/
const packages = fs.readdirSync('../input')
const aliases = Object.fromEntries(
  packages.map(pkg => {
    return [
      `@alinea/input.${pkg}`,
      path.resolve(`../input/${pkg}/src/browser.ts`)
    ]
  })
)

if (usePreact) {
  aliases.react = require.resolve('preact/compat')
  aliases['react-dom'] = require.resolve('preact/compat')
}

esbuild
  .build({
    format: 'esm',
    splitting: true,
    entryPoints: ['src/client.tsx'],
    bundle: true,
    sourcemap: true,
    inject: ['../../scripts/react-shim.js'],
    outdir: 'dist',
    plugins: [
      ScssModulesPlugin({
        cache: false,
        localsConvention: 'dashes',
        generateScopedName: 'alinea-[name]-[local]-[hash:base64:5]'
      }),
      alias(aliases)
    ],
    loader: {
      '.woff': 'file',
      '.woff2': 'file'
    },
    define: {
      'process.env.__NEXT_TRAILING_SLASH': true,
      'process.env.__NEXT_I18N_SUPPORT': false,
      'process.env.__NEXT_ROUTER_BASEPATH': '""',
      'process.env.__NEXT_SCROLL_RESTORATION': true,
      'process.env.__NEXT_HAS_REWRITES': false,
      'process.env.__NEXT_OPTIMIZE_CSS': false,
      'process.env.__NEXT_CROSS_ORIGIN': '""',
      'process.env.__NEXT_STRICT_MODE': false,
      'process.env.__NEXT_IMAGE_OPTS': null
    },
    banner: {
      js: '(() => new EventSource("/~esbuild").onmessage = () => location.reload())();'
    },
    watch: {
      onRebuild(error, result) {
        clients.forEach(res => res.write('data: update\n\n'))
        clients.length = 0
        console.log(error ? error : '...')
      }
    }
  })
  .catch(() => process.exit(1))

// Adapted from: https://github.com/evanw/esbuild/issues/802#issuecomment-819578182

esbuild.serve({servedir: '.'}, {}).then(server => {
  createServer((req, res) => {
    const {url, method, headers} = req
    if (req.url === '/~esbuild')
      return clients.push(
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
      )
    req.pipe(
      request(
        {
          hostname: server.hostname,
          port: server.port,
          path: url,
          method,
          headers
        },
        prxRes => {
          res.writeHead(prxRes.statusCode, prxRes.headers)
          prxRes.pipe(res, {end: true})
        }
      ),
      {end: true}
    )
  }).listen(8000)

  setTimeout(() => {
    const op = {
      darwin: ['open'],
      linux: ['xdg-open'],
      win32: ['cmd', '/c', 'start']
    }
    const ptf = process.platform
    if (clients.length === 0)
      spawn(op[ptf][0], [...[op[ptf].slice(1)], `http://localhost:8000`])
  }, 1000) //open the default browser only if it is not opened yet
})
