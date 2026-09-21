export default { esbuild: { jsx: 'automatic' }, test: { environment: 'jsdom', include: ['src/ui/*.test.{js,jsx}'], fileParallelism: false } }
