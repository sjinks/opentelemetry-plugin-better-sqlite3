import { Span, SpanKind, SpanStatusCode, context, diag, trace } from '@opentelemetry/api';
import {
    InstrumentationBase,
    InstrumentationConfig,
    InstrumentationModuleDefinition,
    InstrumentationNodeModuleDefinition,
    isWrapped,
} from '@opentelemetry/instrumentation';
import { SEMATTRS_DB_NAME, SEMATTRS_DB_STATEMENT, SEMATTRS_DB_SYSTEM } from '@opentelemetry/semantic-conventions';
import type bs3Types from 'better-sqlite3';

const supportedVersions = ['^7.0.0', '^8.0.0', '^9.0.0', '^10.0.0', '^11.0.0'];

export class BetterSqlite3Instrumentation extends InstrumentationBase {
    public static readonly COMPONENT = 'better-sqlite3';

    public constructor(config?: InstrumentationConfig) {
        super('opentelemetry-instrumentation-better-sqlite3', '1.0.0', config);
    }

    protected init(): InstrumentationModuleDefinition[] {
        return [
            new InstrumentationNodeModuleDefinition(
                'better-sqlite3',
                supportedVersions,
                (moduleExports: typeof bs3Types, moduleVersion) => {
                    diag.debug(`Applying patch for better-sqlite3@${moduleVersion}`);

                    const proto = moduleExports.prototype;

                    // istanbul ignore else
                    // eslint-disable-next-line @typescript-eslint/unbound-method
                    if (!isWrapped(proto.exec)) {
                        this._wrap(proto, 'exec', this.patchExec);
                        this._wrap(
                            proto,
                            'prepare',
                            this.patchPrepare as (original: (typeof proto)['prepare']) => (typeof proto)['prepare'],
                        );

                        this._wrap(proto, 'pragma', this.patchPragma);
                    }

                    return moduleExports;
                },
                (moduleExports: typeof bs3Types, moduleVersion) => {
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (moduleExports !== undefined) {
                        diag.debug(`Removing patch for better-sqlite3@${moduleVersion}`);
                        this._massUnwrap([moduleExports.prototype], ['exec', 'prepare', 'pragma']);
                    }
                },
            ),
        ];
    }

    private createSpan(query: string, db: bs3Types.Database, operation?: string): Span {
        const statement = query.trim().split(/\s/u)[0];
        const spanName = operation ? `${operation}: ${statement}` : statement;
        return this.tracer.startSpan(spanName, {
            kind: SpanKind.CLIENT,
            attributes: {
                [SEMATTRS_DB_SYSTEM]: 'sqlite3',
                [SEMATTRS_DB_STATEMENT]: query,
                [SEMATTRS_DB_NAME]: db.name,
            },
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static defaultRunner<F extends (...args: any[]) => unknown>(
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
            return context.with(trace.setSpan(context.active(), span), () =>
                BetterSqlite3Instrumentation.defaultRunner(span, original, this, params),
            ) as ReturnType<typeof original>;
        };
    };

    private readonly patchPrepare = (original: (source: string) => bs3Types.Statement): typeof original => {
        const self = this;
        return function prepare(this: bs3Types.Database, ...params): ReturnType<typeof original> {
            const span = self.createSpan(params[0], this, 'prepare');
            return context.with(trace.setSpan(context.active(), span), () => {
                try {
                    const result = original.apply(this, params);
                    span.setStatus({ code: SpanStatusCode.OK });

                    self._massWrap([result], ['run', 'get', 'all'], self.patchStatement);

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

    private readonly patchPragma = (
        original: (source: string, options?: bs3Types.PragmaOptions) => unknown,
    ): typeof original => {
        const self = this;
        return function pragma(this: bs3Types.Database, ...params): ReturnType<typeof original> {
            const span = self.createSpan(`PRAGMA ${params[0]}`, this);
            return context.with(trace.setSpan(context.active(), span), () =>
                BetterSqlite3Instrumentation.defaultRunner(span, original, this, params),
            );
        };
    };

    private readonly patchStatement = (original: (...params: unknown[]) => unknown): typeof original => {
        const self = this;
        return function statement_handler(this: bs3Types.Statement, ...params): ReturnType<typeof original> {
            if (!self.isEnabled()) {
                self._unwrap(this, original.name as keyof bs3Types.Statement);
                return original.apply(this, params);
            }

            const span = self.createSpan(this.source, this.database, original.name);
            return context.with(trace.setSpan(context.active(), span), () =>
                BetterSqlite3Instrumentation.defaultRunner(span, original, this, params),
            );
        };
    };
}
