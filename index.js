#!/usr/bin/env node

// @ts-check
import { Client, createNotification, createRequest, Instance } from 'butlerd';
import dotenvLoad from 'dotenv-load';
import download from 'download';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import os from 'os';
import path from 'path';
import sanitizeFilename from 'sanitize-filename';
import which from 'which';
import yargs from 'yargs';

dotenvLoad();

const apiKey = process.env.API_KEY;
const dirTemp = os.tmpdir();

const { output: dirOutput, dryRun, published } = yargs(process.argv.slice(2))
	.usage('Usage: $0 -o output [--dry-run] [--published]')
	.example('API_KEY=abcd1234 $0 -o games', 'Download to folder "games"')
	.example('API_KEY=abcd1234 $0 -o . --dry-run', 'List what would be downloaded')
	.option('o', {
		alias: 'output',
		describe: 'Folder to download files to.',
		type: 'string',
		nargs: 1,
		required: true,
	})
	.option('d', {
		alias: 'dry-run',
		describe: 'Print files without downloading them.',
		type: 'boolean',
		nargs: 0,
	})
	.option('p', {
		alias: 'published',
		describe: 'Filter out unpublished games.',
		type: 'boolean',
		nargs: 0,
	})
	.check(({ output }) => {
		if (!output) {
			throw new Error('Output folder required.');
		}

		if (!apiKey) {
			throw new Error('Missing API key. You can get one here: https://itch.io/user/settings/api-keys');
		}
		return true;
	})
	.help('h')
	.alias('h', 'help')
	.epilog('Requires a copy of butler and an itch.io API key, which can be found here:\n- https://itch.io/docs/butler/installing.html\n- https://itch.io/user/settings/api-keys').argv;

async function getGames() {
	const response = await fetch(`https://itch.io/api/1/${apiKey}/my-games`);
	const data = await response.json();
	let games = data.games;
	if (published) {
		games = games.filter(i => i.published);
	}
	return games;
}

async function getButler() {
	let butlerExecutable;
	try {
		butlerExecutable = which.sync('butler');
	} catch (err) {
		console.error('Could not find "butler" executable. You can install it from here: https://itch.io/docs/butler/installing.html');
		process.exit(1);
	}
	const s = new Instance({
		butlerExecutable,
		args: ['--dbpath', path.join(dirTemp, 'butler.db')],
	});
	const client = new Client(await s.getEndpoint());
	const onLog = convo => {
		convo.onNotification(createNotification('Log'), async e => {
			console.log('Log: ', e.level, e.message);
		});
	};
	const butler = {
		request: (r, params = {}) => client.call(createRequest(r), params, onLog),
	};
	const versionResult = await butler.request('Version.Get');
	console.log('version', versionResult);
	const profile = await butler.request('Profile.LoginWithAPIKey', { apiKey });
	console.log(profile);
	return butler;
}

const files = [];
(async function main() {
	const butler = await getButler();

	console.log('Getting game list...');
	const games = await getGames();

	const uploads = (
		await games.reduce(async (acc, game) => {
			const result = await acc;
			console.log(`Getting uploads for "${game.title}"...`);
			const { uploads } = await butler.request('Fetch.GameUploads', { gameId: game.id, compatible: false, fresh: true });
			result.push(uploads.map(i => ({ ...i, game })));
			return result;
		}, Promise.resolve([]))
	).flat();

	// queue downloads
	const downloads = await uploads.reduce(async (acc, upload) => {
		const result = await acc;
		const dir = path.join(sanitizeFilename(upload.game.title), sanitizeFilename((upload.displayName || upload.filename).replace(/\.zip$/i, '')));
		const stagingFolder = path.join(dirTemp, 'staging', dir);
		const installFolder = path.join(dirOutput, dir);
		files.push(installFolder);
		if (dryRun) return result;
		const download = await butler.request('Install.Queue', {
			game: upload.game,
			upload,
			noCave: true,
			fastQueue: true,
			queueDownload: true,
			ignoreInstallers: true,
			installFolder,
			stagingFolder,
		});
		result.push(download);
		return result;
	}, Promise.resolve([]));

	// actually download
	await downloads.reduce(async (acc, download) => {
		await acc;
		await butler.request('Install.Perform', {
			id: download.id,
			stagingFolder: download.stagingFolder,
		});
	}, Promise.resolve());

	// download thumbnails
	await games
		.flatMap(({ title, cover_url, still_cover_url }) => [
			{
				url: cover_url,
				dest: path.join(sanitizeFilename(title), 'cover'),
			},
			{
				url: still_cover_url || cover_url,
				dest: path.join(sanitizeFilename(title), 'still_cover'),
			},
		])
		.filter(i => i.url)
		.reduce(async (result, i) => {
			await result;
			const fileThumbnail = `${i.dest}.${i.url.split('.').pop()}`;
			files.push(path.join(dirOutput, fileThumbnail));
			if (dryRun) return result;
			console.log(`Saving "${i.dest}"...`);
			return download(i.url, dirOutput, { filename: fileThumbnail });
		}, Promise.resolve());

	// save metadata
	await games.reduce(async (result, i) => {
		await result;
		const fileMetadata = path.join(dirOutput, sanitizeFilename(i.title), 'metadata.json');
		files.push(fileMetadata);
		if (dryRun) return;
		console.log(`Saving metadata "${i.title}"...`);
		await fs.ensureDir(path.join(dirOutput, sanitizeFilename(i.title)));
		return fs.writeFile(fileMetadata, JSON.stringify(i, undefined, '\t'));
	}, Promise.resolve());

	const fileTotalMetadata = path.join(dirOutput, 'metadata.json');
	files.push(path.join(dirOutput, 'metadata.json'));
	if (dryRun) return;
	console.log('Saving total metadata...');
	await fs.writeFile(fileTotalMetadata, JSON.stringify(games, undefined, '\t'));
})()
	.then(() => {
		if (dryRun) {
			console.log(JSON.stringify(files.sort(), undefined, 1));
		} else {
			console.log('✅');
		}
		process.exit(0);
	})
	.catch(err => {
		console.log('❌');
		console.error(err);
		process.exit(1);
	});
