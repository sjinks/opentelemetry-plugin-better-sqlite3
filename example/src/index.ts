// This must be the very first import
import './instrumentation';

import opentelemetry from '@opentelemetry/api';
import Database from 'better-sqlite3';
import fetch from 'node-fetch';

const tracer = opentelemetry.trace.getTracer('default');

const span = tracer.startSpan('Root Span');
tracer.withSpan(span, () => {
    const db = new Database(':memory:');
    db.exec(
        'CREATE TABLE cat_breeds (id CHAR(4) NOT NULL PRIMARY KEY, name VARCHAR(255), wikipedia_url VARCHAR(255) NULL)',
    );

    interface BreedModel {
        id: string;
        name: string;
        wikipedia_url: string;
    }

    const insert = db.prepare('INSERT INTO cat_breeds (id, name, wikipedia_url) VALUES (@id, @name, @wikipedia_url)');
    const trx = db.transaction((items: BreedModel[]) => {
        items.forEach(({ id, name, wikipedia_url = null }) => insert.run({ id, name, wikipedia_url }));
    });

    fetch('https://api.thecatapi.com/v1/breeds')
        .then((r) => r.json())
        .then((r: BreedModel[]) => trx(r))
        .catch((e) => console.error(e))
        .finally(() => span.end());
});
