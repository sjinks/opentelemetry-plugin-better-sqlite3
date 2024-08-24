import { equal, fail } from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    type ReadableSpan,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_DB_NAMESPACE, ATTR_DB_QUERY_TEXT, ATTR_DB_SYSTEM } from '@opentelemetry/semantic-conventions/incubating';
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
    equal(spans.name, name);
    equal(spans.status.code, code);
    equal(spans.attributes[ATTR_DB_SYSTEM], 'sqlite3');
    equal(spans.attributes[ATTR_DB_NAMESPACE], ':memory:');
    equal(spans.attributes[ATTR_DB_QUERY_TEXT], stmt);
    equal(spans.status.message, err?.message);
}

void describe('BetterSqlite3Plugin', function () {
    let contextManager: AsyncHooksContextManager;
    let provider: BasicTracerProvider;
    let memoryExporter: InMemorySpanExporter;
    let connection: bs3.Database;

    before(function () {
        provider = new BasicTracerProvider();
        instrumentation.setTracerProvider(provider);
        memoryExporter = new InMemorySpanExporter();
        provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));
    });

    beforeEach(function () {
        contextManager = new AsyncHooksContextManager().enable();
        context.setGlobalContextManager(contextManager);
        instrumentation.enable();

        connection = new bs3(':memory:');
    });

    afterEach(function () {
        context.disable();
        memoryExporter.reset();
        instrumentation.disable();
        connection.close();
    });

    void describe('Instrumentation', function () {
        void it('should export the instrumentation', function () {
            equal(instrumentation instanceof BetterSqlite3Instrumentation, true);
        });

        void it('should have correct instrumentationName', function () {
            equal(instrumentation.instrumentationName, 'opentelemetry-instrumentation-better-sqlite3');
        });

        void it('should handle duplicate calls to enable() gracefully', function () {
            instrumentation.enable();
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                connection.exec('SELECT 1');
                const spans = memoryExporter.getFinishedSpans();
                equal(Array.isArray(spans), true);
                equal(spans.length, 1);
            });
        });
    });

    void describe('Database', function () {
        void it('should patch Database#exec ', function () {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'SELECT 2+2';
                connection.exec(sql);

                const spans = memoryExporter.getFinishedSpans();
                equal(Array.isArray(spans), true);
                equal(spans.length, 1);
                checkSpanAttributes(spans[0], 'SELECT', SpanStatusCode.OK, sql);
            });
        });

        void it('should handle errors in Database#exec', function () {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'SLCT 2+2';
                try {
                    connection.exec(sql);
                    fail();
                } catch (e) {
                    const spans = memoryExporter.getFinishedSpans();
                    equal(Array.isArray(spans), true);
                    equal(spans.length, 1);
                    checkSpanAttributes(spans[0], 'SLCT', SpanStatusCode.ERROR, sql, e as Error);
                }
            });
        });

        void it('should handle errors in Database#prepare', function () {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'UNKNOWN ?';
                try {
                    connection.prepare(sql);
                    fail();
                } catch (e) {
                    const spans = memoryExporter.getFinishedSpans();
                    equal(Array.isArray(spans), true);
                    equal(spans.length, 1);
                    checkSpanAttributes(spans[0], 'prepare: UNKNOWN', SpanStatusCode.ERROR, sql, e as Error);
                }
            });
        });

        void it('should handle Database#pragma', function () {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'PRAGMA journal_mode';
                connection.pragma('journal_mode');
                const spans = memoryExporter.getFinishedSpans();
                equal(Array.isArray(spans), true);
                equal(spans.length > 0, true);
                checkSpanAttributes(spans[spans.length - 1], 'PRAGMA', SpanStatusCode.OK, sql);
            });
        });
    });

    void describe('Statement', function () {
        const runTest = (method: 'all' | 'get' | 'run', sql: string): void => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const stmt = connection.prepare(sql);
                stmt[method]();

                const spans = memoryExporter.getFinishedSpans();
                equal(Array.isArray(spans), true);
                equal(spans.length, 2);
                const what = sql.split(' ')[0].toUpperCase();
                checkSpanAttributes(spans[0], `prepare: ${what}`, SpanStatusCode.OK, sql);
                checkSpanAttributes(spans[1], `${method}: ${what}`, SpanStatusCode.OK, sql);
            });
        };

        void it('should patch Statement#all', () => runTest('all', 'SELECT 2+2'));
        void it('should patch Statement#get', () => runTest('get', 'SELECT 2+2'));
        void it('should patch Statement#run', () => runTest('run', 'ANALYZE'));

        void it('should not create spans in Statement when the plugin gets disabled', function () {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                const sql = 'ANALYZE';
                const stmt = connection.prepare(sql);
                instrumentation.disable();
                stmt.run();
                stmt.run();

                const spans = memoryExporter.getFinishedSpans();
                equal(Array.isArray(spans), true);
                equal(spans.length, 1);
                checkSpanAttributes(spans[0], 'prepare: ANALYZE', SpanStatusCode.OK, sql);
            });
        });
    });
});
