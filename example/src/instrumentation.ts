import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { BetterSqlite3Instrumentation } from 'opentelemetry-plugin-better-sqlite3';

const provider = new NodeTracerProvider();
const zipkinExporter = new ZipkinExporter({
    url: 'http://127.0.0.1:9411/api/v2/spans',
    serviceName: 'example',
});

const zipkinProcessor = new SimpleSpanProcessor(zipkinExporter);
provider.addSpanProcessor(zipkinProcessor);

provider.register();
registerInstrumentations({
    instrumentations: [new BetterSqlite3Instrumentation()],
    tracerProvider: provider,
});
