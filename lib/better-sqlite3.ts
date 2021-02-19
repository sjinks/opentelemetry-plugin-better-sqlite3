/* eslint-disable no-invalid-this */
import { Span, SpanKind, SpanStatusCode, context, setSpan } from '@opentelemetry/api';
import { BasePlugin } from '@opentelemetry/core';
import { DatabaseAttribute } from '@opentelemetry/semantic-conventions';
import type bs3Types from 'better-sqlite3';
import shimmer from 'shimmer';

export class BetterSqlite3Plugin extends BasePlugin<typeof bs3Types> {
    public readonly supportedVersions = ['^7.0.0'];
    public static readonly COMPONENT = 'better-sqlite3';

    private enabled = false;

    public constructor(public readonly moduleName: string) {
        super('opentelemetry-plugin-better-sqlite3');
    }

    protected patch(): typeof bs3Types {
        if (!this.enabled) {
            this.enabled = true;

            const proto = this._moduleExports.prototype;
            shimmer.wrap(proto, 'exec', this.patchExec);
            shimmer.wrap(
                proto,
                'prepare',
                this.patchPrepare as (original: typeof proto['prepare']) => typeof proto['prepare'],
            );
        }

        return this._moduleExports;
    }

    protected unpatch(): void {
        if (this.enabled) {
            this.enabled = false;

            const proto = this._moduleExports.prototype;
            shimmer.massUnwrap([proto], ['exec', 'prepare']);
        }
    }

    private createSpan(query: string, db: bs3Types.Database, operation?: string): Span {
        const statement = query.trim().split(/\s/u)[0];
        const spanName = operation ? `${operation}: ${statement}` : statement;
        return this._tracer.startSpan(spanName, {
            kind: SpanKind.CLIENT,
            attributes: {
                [DatabaseAttribute.DB_SYSTEM]: 'sqlite3',
                [DatabaseAttribute.DB_STATEMENT]: query,
                [DatabaseAttribute.DB_NAME]: db.name,
            },
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static defaultRunner<F extends (...params: any[]) => unknown>(
        span: Span,
        original: F,
        this_: unknown,
        params: unknown[],
    ): unknown {
        try {
            const result = original.apply(this_, params);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (e) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
            throw e;
        } finally {
            span.end();
        }
    }

    private readonly patchExec = (original: (source: string) => bs3Types.Database): typeof original => {
        const self = this;
        return function exec(this: bs3Types.Database, ...params): ReturnType<typeof original> {
            const span = self.createSpan(params[0], this);
            return context.with(setSpan(context.active(), span), () =>
                BetterSqlite3Plugin.defaultRunner(span, original, this, params),
            ) as ReturnType<typeof original>;
        };
    };

    private readonly patchPrepare = (original: (source: string) => bs3Types.Statement): typeof original => {
        const self = this;
        return function prepare(this: bs3Types.Database, ...params): ReturnType<typeof original> {
            const span = self.createSpan(params[0], this, 'prepare');
            return context.with(setSpan(context.active(), span), () => {
                try {
                    const result = original.apply(this, params);
                    span.setStatus({ code: SpanStatusCode.OK });

                    shimmer.massWrap([result], ['run', 'get', 'all'], self.patchStatement);

                    return result;
                } catch (e) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
                    throw e;
                } finally {
                    span.end();
                }
            });
        };
    };

    private readonly patchStatement = (original: (...params: unknown[]) => unknown): typeof original => {
        const self = this;
        return function statement_handler(this: bs3Types.Statement, ...params): ReturnType<typeof original> {
            if (!self.enabled) {
                shimmer.unwrap(this, original.name as keyof bs3Types.Statement);
                return original.apply(this, params);
            }

            const span = self.createSpan(this.source, this.database, original.name);
            return context.with(setSpan(context.active(), span), () =>
                BetterSqlite3Plugin.defaultRunner(span, original, this, params),
            );
        };
    };
}

export const plugin = new BetterSqlite3Plugin(BetterSqlite3Plugin.COMPONENT);
