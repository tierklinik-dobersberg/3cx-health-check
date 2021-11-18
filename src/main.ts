import { createClient, ConsoleClient, IHttpClient, DashboardClient } from '@3cx/api';
import * as axios from 'axios';

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

    const systemStatus = await dash.getSystemStatus();
    console.log(systemStatus)

    if (!systemStatus.Activated) {
        throw "System is not activated"
    }

    if (cfg.pbxMinExtensions !== undefined) {
        if (systemStatus.ExtensionsRegistered < cfg.pbxMinExtensions) {
            throw `Expected at least ${cfg.pbxMinExtensions} extensions to be registered. Found ${systemStatus.ExtensionsRegistered}`;
        }
    }

    if (systemStatus.HasNotRunningServices) {
        throw `System reports failed services`
    }

    if (systemStatus.HasUnregisteredSystemExtensions) {
        throw `System reports unregistered system extension`
    }

    if(cfg.pbxMinTrunks !== undefined) {
        if (systemStatus.TrunksRegistered < cfg.pbxMinTrunks) {
            throw `Expected at least ${cfg.pbxMinTrunks} trunks to be registered. Found ${systemStatus.TrunksRegistered}`;
        }
    }

    if(systemStatus.PhysicalMemoryUsage > 75) {
        throw `Physical memory usage is at ${systemStatus.PhysicalMemoryUsage}`
    }

    if(systemStatus.CpuUsage > 75) {
        throw `CPU usage is at ${systemStatus.CpuUsage}`
    }

    if(systemStatus.DiskUsage > 75) {
        throw `Disk usage is at ${systemStatus.CpuUsage}`
    }
}

async function reportFailure(cfg: Config, error: any) {
    console.log(`[FAIL] Reporting 3CX failure`)
    if (typeof error === 'object' && 'toString' in error) {
        error = error.toString()
    }

    await axios.default.post(`${cfg.HealthCheckServer}/ping/${cfg.HealthCheckUID}/fail`, error)
}

async function reportSuccess(cfg: Config) {
    console.log(`[ OK ] 3CX PBX is healthy, reporting ...`)
    await axios.default.get(`${cfg.HealthCheckServer}/ping/${cfg.HealthCheckUID}`)
}

async function sleep(timeout: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, timeout))
}

async function main() {
    console.log("[INFO] starting 3cx health check...")

    const cfg = loadConfig()
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