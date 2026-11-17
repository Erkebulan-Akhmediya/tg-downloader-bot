#!/usr/bin/env node
// Stand-in for yt-dlp used by the tests. Records nothing on disk.
const args = process.argv.slice(2);

if (args.includes('--version')) {
    process.stdout.write('2099.01.01\n');
    process.exit(0);
}

if (args.includes('-J')) {
    const url = args[args.length - 1];
    if (url.includes('fail')) {
        process.stderr.write('ERROR: [fake] unable to extract\n');
        process.exit(1);
    }
    process.stdout.write(JSON.stringify({ id: 'abc', webpage_url: url, url: 'https://cdn/v.mp4', vcodec: 'avc1', args }));
    process.exit(0);
}

if (args.includes('--load-info-json')) {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (input += c));
    process.stdin.on('end', () => {
        const info = JSON.parse(input);
        if (info.failMidway) {
            process.stdout.write('partial-bytes', () => {
                process.stderr.write('ERROR: [fake] connection reset\n');
                process.exit(1);
            });
            return;
        }
        process.stdout.write(info.payload || 'VIDEO-BYTES', () => process.exit(0));
    });
    return;
}

process.stderr.write('unexpected args ' + args.join(' ') + '\n');
process.exit(2);
