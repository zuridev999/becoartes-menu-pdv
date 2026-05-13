import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const imagesDir = '/Users/guimameluco/.gemini/antigravity/scratch/becoartes-menu-pdv/public/images';

async function main() {
  const files = fs.readdirSync(imagesDir);
  for (const file of files) {
    if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') || file.toLowerCase().endsWith('.png')) {
      const filePath = path.join(imagesDir, file);
      const tempPath = path.join(imagesDir, 'temp-' + file);
      
      console.log(`Resizing ${file}...`);
      try {
        await sharp(filePath)
          .resize(800) // 800px width
          .jpeg({ quality: 80 })
          .toFile(tempPath);
        
        fs.renameSync(tempPath, filePath);
      } catch (err) {
        console.error(`Failed to resize ${file}: ${err.message}`);
      }
    }
  }
}

main();
