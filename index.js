#!/usr/bin/env node

// @ts-check
import { Client, createNotification, createRequest, Instance } from 'butlerd';
import dotenvLoad from 'dotenv-load';
import download from 'download';
import fs from 'fs';
import fetch from 'node-fetch';
import os from 'os';
import path from 'path';
import sanitizeFilename from 'sanitize-filename';
import which from 'which';
dotenvLoad();

const apiKey = process.env.API_KEY;
if (!apiKey) {
	console.error('Missing API key.');
	process.exit(1);
}

const dirTemp = os.tmpdir();

const [dirOutput] = process.argv.slice(2);
if (!dirOutput) {
	console.error('Missing output directory.');
	process.exit(1);
}

async function getGames() {
	const response = await fetch(`https://itch.io/api/1/${apiKey}/my-games`);
	const data = await response.json();
	const games = data.games;
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

(async function main() {
	const butler = await getButler();

	const games = await getGames();

	const uploads = (
		await Promise.all(
			games.map(async game => {
				const { uploads } = await butler.request('Fetch.GameUploads', { gameId: game.id, compatible: false, fresh: true });
				return uploads.map(i => ({ ...i, game }));
			})
		)
	).flat();

	// queue downloads
	const downloads = await Promise.all(
		uploads.map(async upload => {
			const dir = path.join(sanitizeFilename(upload.game.title), sanitizeFilename((upload.displayName || upload.filename).replace(/\.zip$/i, '')));
			const stagingFolder = path.join(dirTemp, 'staging', dir);
			const installFolder = path.join(dirOutput, dir);
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
			return download;
		})
	);

	// actually download
	await Promise.all(
		downloads.map(
			async download =>
				await butler.request('Install.Perform', {
					id: download.id,
					stagingFolder: download.stagingFolder,
				})
		)
	);

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
		.reduce(async (result, i) => {
			await result;
			return download(i.url, dirOutput, { filename: `${i.dest}.${i.url.split('.').pop()}` });
		}, Promise.resolve());

	// save metadata
	await games.reduce(async (result, i) => {
		await result;
		return fs.promises.writeFile(path.join(dirOutput, sanitizeFilename(i.title), 'metadata.json'), JSON.stringify(i, undefined, '\t'));
	}, Promise.resolve());
	
	const totalMetadata = games
		.sort((a, b) => b.published_at.localeCompare(a.published_at));
	await fs.promises.writeFile(path.join(dirOutput, 'metadata.json'), JSON.stringify(totalMetadata, undefined, '\t'));
})()
	.then(() => {
		console.log('✅');
		process.exit(0);
	})
	.catch(err => {
		console.log('❌');
		console.error(err);
		process.exit(1);
	});
