import { SpanStatusCode, context, setSpan } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/node';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/tracing';
import bs3 from 'better-sqlite3';
import { DatabaseAttribute } from '@opentelemetry/semantic-conventions';
import { BetterSqlite3Plugin, plugin } from '../lib';

function checkSpanAttributes(
    spans: Readonly<ReadableSpan>,
    name: string,
    code: SpanStatusCode,
    stmt: string,
    err?: Error,
): void {
    expect(spans.name).toBe(name);
    expect(spans.status.code).toBe(code);
    expect(spans.attributes[DatabaseAttribute.DB_SYSTEM]).toBe('sqlite3');
    expect(spans.attributes[DatabaseAttribute.DB_NAME]).toBe(':memory:');
    expect(spans.attributes[DatabaseAttribute.DB_STATEMENT]).toBe(stmt);
    expect(spans.status.message).toBe(err?.message);
}

describe('BetterSqlite3Plugin', () => {
    let contextManager: AsyncHooksContextManager;
    let connection: bs3.Database;
    const provider = new NodeTracerProvider();
    const memoryExporter = new InMemorySpanExporter();

    beforeAll(() => {
        provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));
    });

    afterAll(() => connection.close());

    beforeEach(() => {
        contextManager = new AsyncHooksContextManager().enable();
        context.setGlobalContextManager(contextManager);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugin.enable(bs3 as any, provider);

        connection = new bs3(':memory:');
    });

    afterEach(() => {
        context.disable();
        memoryExporter.reset();
        plugin.disable();
    });

    describe('Plugin', () => {
        it('should export a plugin', () => {
            expect(plugin).toBeInstanceOf(BetterSqlite3Plugin);
        });

        it('should have correct moduleName', () => {
            expect(plugin.moduleName).toBe('better-sqlite3');
        });

        it('should handle duplicate calls to enable() gracefully', () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            plugin.enable(bs3 as any, provider);
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                connection.exec('SELECT 1');
                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(1);
            });
        });
    });

    describe('Database', () => {
        it('should patch Database#exec ', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'SELECT 2+2';
                connection.exec(sql);

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(1);
                checkSpanAttributes(spans[0], 'SELECT', SpanStatusCode.OK, sql);
            });
        });

        it('should handle errors in Database#exec', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'SLCT 2+2';
                try {
                    connection.exec(sql);
                    fail();
                } catch (e) {
                    const spans = memoryExporter.getFinishedSpans();
                    expect(spans).toHaveLength(1);
                    checkSpanAttributes(spans[0], 'SLCT', SpanStatusCode.ERROR, sql, e);
                }
            });
        });

        it('should handle errors in Database#prepare', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'UNKNOWN ?';
                try {
                    connection.prepare(sql);
                    fail();
                } catch (e) {
                    const spans = memoryExporter.getFinishedSpans();
                    expect(spans).toHaveLength(1);
                    checkSpanAttributes(spans[0], 'prepare: UNKNOWN', SpanStatusCode.ERROR, sql, e);
                }
            });
        });

        it('should handle Database#pragma', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'PRAGMA journal_mode';
                connection.pragma('journal_mode');
                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(2);
                checkSpanAttributes(spans[0], 'prepare: PRAGMA', SpanStatusCode.OK, sql);
                checkSpanAttributes(spans[1], 'all: PRAGMA', SpanStatusCode.OK, sql);
            });
        });
    });

    describe('Statement', () => {
        it.each<['all' | 'get']>([['all'], ['get']])('should patch Statement#%s', (method) => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'SELECT 2+2';
                const stmt = connection.prepare(sql);
                stmt[method]();

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(2);
                checkSpanAttributes(spans[0], 'prepare: SELECT', SpanStatusCode.OK, sql);
                checkSpanAttributes(spans[1], `${method}: SELECT`, SpanStatusCode.OK, sql);
            });
        });

        it('should patch Statement#run', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'ANALYZE';
                const stmt = connection.prepare(sql);
                stmt.run();

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(2);
                checkSpanAttributes(spans[0], 'prepare: ANALYZE', SpanStatusCode.OK, sql);
                checkSpanAttributes(spans[1], 'run: ANALYZE', SpanStatusCode.OK, sql);
            });
        });

        it('should not create spans in Statement when the plugin gets disabled', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(setSpan(context.active(), span), () => {
                const sql = 'ANALYZE';
                const stmt = connection.prepare(sql);
                plugin.disable();
                stmt.run();
                stmt.run();

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(1);
                checkSpanAttributes(spans[0], 'prepare: ANALYZE', SpanStatusCode.OK, sql);
            });
        });
    });
});
