import { NodeTracerProvider } from '@opentelemetry/node';
import { SimpleSpanProcessor } from '@opentelemetry/tracing';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';

const provider = new NodeTracerProvider({
    plugins: {
        https: {},
        'better-sqlite3': {
            path: 'opentelemetry-plugin-better-sqlite3',
        },
    },
});

const zipkinExporter = new ZipkinExporter({
    url: 'http://127.0.0.1:9411/api/v2/spans',
    serviceName: 'example',
});

const zipkinProcessor = new SimpleSpanProcessor(zipkinExporter);
provider.addSpanProcessor(zipkinProcessor);

provider.register();
