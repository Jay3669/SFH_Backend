import { QueryTypes, Sequelize } from 'sequelize';
import { logger } from '../utils/logger.js';

const database = process.env.DB_NAME || 'SuryaFoodHub';
export const schema = process.env.DB_SCHEMA || 'food_hub';
const username = process.env.DB_USER;
const password = process.env.DB_PASSWORD;
const host = process.env.DB_HOST || '127.0.0.1';
const port = Number(process.env.DB_PORT || 5432);
const sslEnabled = process.env.DB_SSL === 'true';

if (!username || !password) {
    throw new Error('DB_USER and DB_PASSWORD must be set in the environment.');
}

if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error('DB_SCHEMA must be a valid PostgreSQL schema identifier.');
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
}

export const sequelize = new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'postgres',
    timezone: 'Asia/Kolkata',
    logging: false,
    dialectOptions: {
        options: `-c search_path=${schema}`,
        ...(sslEnabled ? { ssl: { require: false } } : {}),
    },
});

export async function connectDatabase() {
    await sequelize.authenticate();

    const schemas = await sequelize.query(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
        {
            bind: [schema],
            type: QueryTypes.SELECT,
        },
    );

    if (schemas.length === 0) {
        throw new Error(`PostgreSQL schema "${schema}" does not exist in database "${database}".`);
    }

    logger.info('Connected to PostgreSQL', { database, schema });
}