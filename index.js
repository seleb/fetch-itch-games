import download from 'download';
import fs from 'fs';
import moment from 'moment';
import fetch from 'node-fetch';
import sanitizeFilename from 'sanitize-filename';

(async function fetchGames() {
	const apiKey = process.env.API_KEY;
	const response = await fetch(`https://itch.io/api/1/${apiKey}/my-games`);
	const data = await response.json();
	const games = data.games;//.slice(0, 3);

	await games
		.filter(({ published }) => published)
		.flatMap(({ title, cover_url, still_cover_url }) => [
			{
				url: cover_url,
				dest: `${sanitizeFilename(title).trim()}/preview`,
			},
			{
				url: still_cover_url || cover_url,
				dest: `${sanitizeFilename(title).trim()}/thumbnail`,
			},
		])
		.reduce(async (result, i) => {
			await result;
			return download(i.url, './thumbnails', { filename: `${i.dest}.${i.url.split('.').pop()}` });
		}, Promise.resolve());

	const output = games
		.filter(({ published }) => published)
		.sort((a, b) => b.published_at.localeCompare(a.published_at))
		.map(({ title, short_text: tagline, published_at, url, cover_url, still_cover_url }) => ({
			title,
			thumbnail: `thumbnails/${sanitizeFilename(title).trim()}/thumbnail.${cover_url.split('.').pop()}`,
			preview: `thumbnails/${sanitizeFilename(title).trim()}/preview.${(still_cover_url || cover_url).split('.').pop()}`,
			association: '',
			date: moment(published_at).format('MMMM YYYY'),
			tagline,
			description: '',
			links: [url],
		}));
	await fs.promises.writeFile('./db.json', JSON.stringify(output, undefined, '\t'));
})().catch(err => {
	console.error(err);
});
