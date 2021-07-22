import { expect } from 'chai';
import forEach from 'mocha-each';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, ReadableSpan, SimpleSpanProcessor } from '@opentelemetry/tracing';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { BetterSqlite3Instrumentation } from '../lib';

// The instrumentation must be loaded before the module it is going to instrument
const instrumentation = new BetterSqlite3Instrumentation();
instrumentation.disable();

// eslint-disable-next-line import/order
import bs3 from 'better-sqlite3';

function checkSpanAttributes(
    spans: Readonly<ReadableSpan>,
    name: string,
    code: SpanStatusCode,
    stmt: string,
    err?: Error,
): void {
    expect(spans.name).to.equal(name);
    expect(spans.status.code).to.equal(code);
    expect(spans.attributes[SemanticAttributes.DB_SYSTEM]).to.equal('sqlite3');
    expect(spans.attributes[SemanticAttributes.DB_NAME]).to.equal(':memory:');
    expect(spans.attributes[SemanticAttributes.DB_STATEMENT]).to.equal(stmt);
    expect(spans.status.message).to.equal(err?.message);
}

describe('BetterSqlite3Plugin', () => {
    let contextManager: AsyncHooksContextManager;
    const provider = new BasicTracerProvider();
    instrumentation.setTracerProvider(provider);
    const memoryExporter = new InMemorySpanExporter();
    provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));

    let connection: bs3.Database;

    beforeEach(() => {
        contextManager = new AsyncHooksContextManager().enable();
        context.setGlobalContextManager(contextManager);
        instrumentation.enable();

        connection = new bs3(':memory:');
    });

    afterEach(() => {
        context.disable();
        memoryExporter.reset();
        instrumentation.disable();
        connection.close();
    });

    describe('Instrumentation', () => {
        it('should export the instrumentation', () => {
            expect(instrumentation).to.be.instanceOf(BetterSqlite3Instrumentation);
        });

        it('should have correct instrumentationName', () => {
            expect(instrumentation.instrumentationName).to.equal('opentelemetry-instrumentation-better-sqlite3');
        });

        it('should handle duplicate calls to enable() gracefully', () => {
            instrumentation.enable();
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                connection.exec('SELECT 1');
                const spans = memoryExporter.getFinishedSpans();
                expect(spans).to.be.an('array').and.have.length(1);
            });
        });
    });

    describe('Database', () => {
        it('should patch Database#exec ', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'SELECT 2+2';
                connection.exec(sql);

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).to.be.an('array').and.have.length(1);
                checkSpanAttributes(spans[0], 'SELECT', SpanStatusCode.OK, sql);
            });
        });

        it('should handle errors in Database#exec', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'SLCT 2+2';
                try {
                    connection.exec(sql);
                    expect.fail();
                } catch (e) {
                    const spans = memoryExporter.getFinishedSpans();
                    expect(spans).to.be.an('array').and.have.length(1);
                    checkSpanAttributes(spans[0], 'SLCT', SpanStatusCode.ERROR, sql, e);
                }
            });
        });

        it('should handle errors in Database#prepare', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'UNKNOWN ?';
                try {
                    connection.prepare(sql);
                    expect.fail();
                } catch (e) {
                    const spans = memoryExporter.getFinishedSpans();
                    expect(spans).to.be.an('array').and.have.length(1);
                    checkSpanAttributes(spans[0], 'prepare: UNKNOWN', SpanStatusCode.ERROR, sql, e);
                }
            });
        });

        it('should handle Database#pragma', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'PRAGMA journal_mode';
                connection.pragma('journal_mode');
                const spans = memoryExporter.getFinishedSpans();
                expect(spans).to.be.an('array').and.have.length.greaterThan(0);
                checkSpanAttributes(spans[spans.length - 1], 'PRAGMA', SpanStatusCode.OK, sql);
            });
        });
    });

    describe('Statement', () => {
        forEach([['all'], ['get']]).it('should patch Statement#%s', (method: 'all' | 'get') => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'SELECT 2+2';
                const stmt = connection.prepare(sql);
                stmt[method]();

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).to.be.an('array').and.have.length(2);
                checkSpanAttributes(spans[0], 'prepare: SELECT', SpanStatusCode.OK, sql);
                checkSpanAttributes(spans[1], `${method}: SELECT`, SpanStatusCode.OK, sql);
            });
        });

        it('should patch Statement#run', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'ANALYZE';
                const stmt = connection.prepare(sql);
                stmt.run();

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).to.be.an('array').and.have.length(2);
                checkSpanAttributes(spans[0], 'prepare: ANALYZE', SpanStatusCode.OK, sql);
                checkSpanAttributes(spans[1], 'run: ANALYZE', SpanStatusCode.OK, sql);
            });
        });

        it('should not create spans in Statement when the plugin gets disabled', () => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'ANALYZE';
                const stmt = connection.prepare(sql);
                instrumentation.disable();
                stmt.run();
                stmt.run();

                const spans = memoryExporter.getFinishedSpans();
                expect(spans).to.be.an('array').and.have.length(1);
                checkSpanAttributes(spans[0], 'prepare: ANALYZE', SpanStatusCode.OK, sql);
            });
        });
    });
});
