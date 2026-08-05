/**
 * MV3 manifest generation. Domains live here (single source of truth),
 * dev-only origins are appended when building in watch/dev mode.
 */

export const GAME_MATCHES = [
    'https://www.bondageprojects.elementfx.com/*/BondageClub*',
    'https://www.bondage-europe.com/*/BondageClub*',
    'https://www.bondageprojects.com/*',
];

export const DEV_MATCHES = [
    'http://localhost:3050/*',
];

export function buildManifest({ dev, version }) {
    const matches = dev ? [...GAME_MATCHES, ...DEV_MATCHES] : GAME_MATCHES;

    return {
        manifest_version: 3,
        name: `BC Toolbox${dev ? ' (Dev)' : ''}`,
        description: 'Member lookup, chat logging and tools for Bondage Club',
        version,
        icons: {
            128: 'bclub-logo.png',
        },
        action: {
            default_icon: 'bclub-logo.png',
            default_title: 'BC Toolbox',
            default_popup: 'popup.html',
        },
        permissions: ['storage', 'tabs', 'downloads', 'notifications', 'alarms'],
        host_permissions: matches,
        background: {
            service_worker: 'background.js',
            type: 'module',
        },
        content_scripts: [
            {
                matches,
                js: ['content.js'],
                run_at: 'document_end',
            },
        ],
        web_accessible_resources: [
            {
                matches: GAME_MATCHES.map(originOnly),
                resources: ['injected.js'],
            },
        ],
        content_security_policy: {
            extension_pages: "script-src 'self'; object-src 'self';",
        },
    };
}

/** web_accessible_resources matches must be origin patterns without paths */
function originOnly(pattern) {
    const url = new URL(pattern.replace('/*', '/x'));
    return `${url.origin}/*`;
}
