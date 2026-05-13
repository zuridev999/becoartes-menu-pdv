import fs from 'fs';
import path from 'path';

const baseDir = '/Users/guimameluco/.gemini/antigravity/scratch/becoartes-menu-pdv/public/images';

function walk(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg')) {
      const cleanName = file.toLowerCase()
        .replace(/ /g, '-')
        .replace(/[áàâã]/g, 'a')
        .replace(/[éê]/g, 'e')
        .replace(/[í]/g, 'i')
        .replace(/[óôõ]/g, 'o')
        .replace(/[ú]/g, 'u')
        .replace(/[ç]/g, 'c')
        .replace(/[^a-z0-9.-]/g, '');
      
      const targetPath = path.join(baseDir, cleanName);
      fs.copyFileSync(fullPath, targetPath);
      console.log(`Copied ${file} to ${cleanName}`);
    }
  }
}

const rootFiles = fs.readdirSync(baseDir);
const folder = rootFiles.find(function(f) { return f.includes('SELEC'); });
if (folder) {
    walk(path.join(baseDir, folder));
} else {
    console.error('Folder not found');
}
