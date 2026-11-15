/* global module, __dirname */
module.exports = {
  apps: [
    {
      name: '2dpw',
      cwd: __dirname,
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'packages/server/src/main.ts',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '7788',
      },
    },
  ],
};
