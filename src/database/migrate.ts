import 'reflect-metadata';

import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from './mikro-orm.config';

async function migrate(): Promise<void> {
  const orm = await MikroORM.init(mikroOrmConfig);
  try {
    await orm.migrator.up();
  } finally {
    await orm.close(true);
  }
}

void migrate();
