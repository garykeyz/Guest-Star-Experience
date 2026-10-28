import {installGameScenes} from './game-scenes.js';
const canvas=document.getElementById('starScreenCanvas');
if(canvas){const controller=installGameScenes(canvas);window.addEventListener('beforeunload',()=>controller.destroy(),{once:true});}
