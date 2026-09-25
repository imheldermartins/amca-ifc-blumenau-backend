import {defineConfig} from '@cubs/rqlite-client/config';

export default defineConfig({
  schemas: ['src/db/schemas'],
  output: 'src/db/rqlite.generated.ts',
  migrations: 'src/db/migrations',
  build: {
    config: 'dist/rqlite.config.js',
    client: 'dist/db/rqlite.generated.js',
    migrations: 'dist/db/migrations',
  },
  environments: {
    development: {urlEnv:'DATABASE_URL',development:true},
    test: {url:'http://127.0.0.1:18012',development:true},
    foreignKeys: {url:'http://127.0.0.1:18014',development:true},
    production: {urlEnv:'DATABASE_URL',development:false},
  },
});
