export const JUICE_IMAGES = {
 'suco_abacaxi_400ml_20261003': '/images/products/suco-abacaxi.webp',
 'suco_caju_400ml_20261003': '/images/products/suco-caju.webp',
 'suco_maracuja_400ml_20261003': '/images/products/suco-maracuja.webp',
 'suco_maca_400ml_20261014': '/images/products/suco-maca.webp',
};
// Fill only missing images; never overwrite staff uploads or alter visibility/prices.
export async function repairJuiceImages(db) {
 return db.batch(Object.entries(JUICE_IMAGES).map(([id,image])=>({sql:"UPDATE menu SET image=? WHERE id=? AND TRIM(COALESCE(image,''))=''",args:[image,id]})),'write');
}
