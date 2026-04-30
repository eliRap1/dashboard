export function faceForHp(hp: number): string {
  if (hp >= 80) return "(◕‿◕)";
  if (hp >= 50) return "(•ᴗ•)";
  if (hp >= 25) return "(-_-)";
  return "(╥﹏╥)";
}
