export default { esbuild: { jsx: 'automatic' }, test: { environment: 'jsdom', include: ['src/ui/plugins/*.test.{js,jsx}'], fileParallelism: false } }
