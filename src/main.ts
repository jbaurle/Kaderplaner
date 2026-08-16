import './styles/base.css';
import './styles/planning.css';
import './styles/lineup.css';
import { App } from './ui/app.js';

const host = document.getElementById('app');
if (!host) throw new Error('#app container missing in index.html');

new App({ host }).start();
