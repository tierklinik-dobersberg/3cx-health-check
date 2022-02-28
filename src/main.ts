import { createClient, ConsoleClient, IHttpClient, DashboardClient, ISystemStatus } from '@3cx/api';
import * as axios from 'axios';
import serverFactory from 'express';
import { register, Counter, Gauge, Summary } from 'prom-client';

const activeCallsCounter = new Counter<string>({
    name: 'pbx_active_calls_counter',
    help: 'help'
})
const activeCallsGauge = new Gauge<string>({
    name: 'pbx_active_calls',
    help: 'help'
})
const cpuUsage = new Gauge<string>({
    name: 'pbx_cpu_usage',
    help: 'help',
})
const diskUsage = new Gauge<string>({
    name: 'pbx_disk_usage',
    help: 'help'
})
const extensionsTotal = new Gauge<string>({
    name: 'pbx_extensions_total',
    help: 'help'
})
const extensionsRegistered = new Gauge<string>({
    name: 'pbx_extensions_registered',
    help: 'help'
})
const freeDiskSpace = new Gauge<string>({
    name: 'pbx_disk_free',
    help: 'help'
})
const freeVirtualMemory = new Gauge<string>({
    name: 'pbx_memory_virtual_free',
    help: 'help'
})
const freePhysicalMemory = new Gauge<string>({
    name: 'pbx_memory_physical_free',
    help: 'help'
})
const usedVirtualMemory = new Gauge<string>({
    name: 'pbx_memory_virtual_used',
    help: 'help'
})
const usedPhysicalMemory = new Gauge<string>({
    name: 'pbx_memory_physical_used',
    help: 'help',
})
const totalDiskSpace = new Gauge<string>({
    name: 'pbx_disk_total',
    help: 'help'
})
const totalPhysicalMemory = new Gauge<string>({
    name: 'pbx_memory_physical_total',
    help: 'help',
})
const totalVirtualMemory = new Gauge<string>({
    name: 'pbx_memory_virtual_total',
    help: 'help',
})
const trunksRegistered = new Gauge<string>({
    name: 'pbx_trunks_registered',
    help: 'help'
})
const trunksTotal = new Gauge<string>({
    name: 'pbx_trunks_total',
    help: 'help'
})
const pollTime = new Summary<string>({
    name: 'pbx_polls',
    help: 'help',
})

function updateMetrics(stats: ISystemStatus) {
    if (!stats) {
        return;
    }
    cpuUsage.set(stats.CpuUsage)
    activeCallsCounter.inc(stats.CallsActive)
    activeCallsGauge.set(stats.CallsActive);
    diskUsage.set(stats.DiskUsage);
    extensionsTotal.set(stats.ExtensionsTotal)
    extensionsRegistered.set(stats.ExtensionsRegistered)
    freeDiskSpace.set(stats.FreeDiskSpace)
    freeVirtualMemory.set((stats as any).FreeVirtualMemory)
    freePhysicalMemory.set(stats.FreePhysicalMemory)
    usedVirtualMemory.set(stats.MemoryUsage)
    usedPhysicalMemory.set(stats.PhysicalMemoryUsage)
    totalDiskSpace.set(stats.TotalDiskSpace)
    totalPhysicalMemory.set(stats.TotalPhysicalMemory)
    totalVirtualMemory.set(stats.TotalVirtualMemory)
    trunksRegistered.set(stats.TrunksRegistered)
    trunksTotal.set(stats.TrunksTotal)
}

interface Config {
    HealthCheckServer: string;
    HealthCheckUID: string;
    Interval: number | null;
    pbxHost: string;
    pbxUser: string;
    pbxPassword: string;
    pbxMinExtensions?: number;
    pbxMinTrunks?: number;
}

/** returns the value of the environment variable key or throws an error */
function mustGetEnv(key: string): string {
    const val = process.env[key];
    if (!val) {
        throw new Error(`${key} must be set in the process environment`)
    }
    return val;
}

/** loads and validates the configuration from the process environment */
function loadConfig(): Config {
    let interval: number | null = null;
    if (!!process.env['INTERVAL_SEC']) {
        const i = +(process.env['INTERVAL_SEC']);
        if (isNaN(i)) {
            throw new Error(`INTERVAL_SEC must be a number`)
        }
        interval = i * 1000;
    }

    const cfg: Config = {
        HealthCheckServer: mustGetEnv('HC_SERVER'),
        HealthCheckUID: mustGetEnv('HC_PING_UID'),
        Interval: interval,
        pbxHost: mustGetEnv('PBX_HOST'),
        pbxUser: mustGetEnv('PBX_USER'),
        pbxPassword: mustGetEnv('PBX_PASSWORD')
    }

    if (!!process.env['PBX_MIN_EXTENSIONS']) {
        const num = +(process.env['PBX_MIN_EXTENSIONS'])
        if (isNaN(num)) {
            throw new Error(`PBX_MIN_EXTENSIONS must be set to a number or undefined.`)
        }
        cfg.pbxMinExtensions = num
    }

    if (!!process.env['PBX_MIN_TRUNKS']) {
        const num = +(process.env['PBX_MIN_TRUNKS'])
        if (isNaN(num)) {
            throw new Error(`PBX_MIN_TRUNKS must be set to a number or undefined.`)
        }
        cfg.pbxMinTrunks = num
    }

    return cfg
}

async function checkStatus(http: IHttpClient, cfg: Config) {
    const dash = new DashboardClient(http);

    const pollTimer = pollTime.startTimer()
    let systemStatus: ISystemStatus;

    try {
        systemStatus = await dash.getSystemStatus();
    } finally {
        pollTimer()
    }

    try {
        updateMetrics(systemStatus);
    } catch(err) {
        console.error("failed to update metrics", err)
    }
}

async function reportFailure(cfg: Config, error: any) {
    console.log(`[FAIL] Reporting pbx failure`, error)
    if (typeof error === 'object' && 'toString' in error) {
        error = error.toString()
    }

    await axios.default.post(`${cfg.HealthCheckServer}/ping/${cfg.HealthCheckUID}/fail`, error)
}

async function reportSuccess(cfg: Config) {
    await axios.default.get(`${cfg.HealthCheckServer}/ping/${cfg.HealthCheckUID}`)
}

async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeout))
}

async function main() {
    console.log("[INFO] starting pbx health check...")

    const cfg = loadConfig()

    const server = serverFactory()
    server.get('/metrics', async (req, res) => {
        try {
            res.set('Content-Type', register.contentType);
            res.end(await register.metrics());
        } catch (ex) {
            res.status(500).end(ex);
        }
    })

    poll(cfg);

    const port = process.env.PORT || 3000;
    console.log(
        `Server listening to ${port}, metrics exposed on /metrics endpoint`,
    );
    server.listen(port);
}

async function poll(cfg: Config) {
    const http = await createClient(cfg.pbxHost, {Username: cfg.pbxUser, Password: cfg.pbxPassword});
    while(true) {
        await checkStatus(http, cfg)
            .then(() => reportSuccess(cfg))
            .catch((e: any) => reportFailure(cfg, e))

        if (cfg.Interval !== null) {
            await sleep(cfg.Interval)
        } else {
            break
        }
    }
}

main()