import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true,
    preserveModules: true,
    preserveModulesRoot: 'src'
  },
  external: [
    /node_modules/,
    'node:fs',
    'node:path',
    'node:url',
    'node:crypto',
    'node:http',
    'node:https',
    'node:stream',
    'node:util',
    'node:buffer',
    'node:process'
  ],
  plugins: [
    resolve({
      preferBuiltins: true,
      exportConditions: ['node']
    }),
    commonjs(),
    json(),
    typescript({
      tsconfig: './tsconfig.json',
      outputToFilesystem: true
    })
  ]
};