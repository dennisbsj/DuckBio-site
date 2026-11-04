#!/usr/bin/env python3
"""Retouch EXISTING DuckBio website banners in-place at pixel level.

No scenes/backgrounds are regenerated.  Materials and Core hologram panels
are processed in the original 2172x724 raster photographs, preserving crop.
"""
from pathlib import Path
import math
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parents[1] / "docs" / "assets" if __file__.startswith('/') and 'scripts' in __file__ else Path('docs/assets')
# Production script lives in repo/scripts, tested from repository root.
FNS={
 'home':'duckbio-home-correct-logo-20261103.webp',
 'support':'duckbio-support-correct-logo-20261103.webp',
 'pricing':'duckbio-pricing-correct-logo-20261103.webp',
}
OUT={
 'home':'duckbio-home-printed-core-20261104.webp',
 'support':'duckbio-support-printed-20261104.webp',
 'pricing':'duckbio-pricing-printed-20261104.webp',
}
# Local rectangle regions correspond exactly to printed logos visible in the
# existing photographs.  Coordinates in original 2172x724 asset space.
PRINT_REGIONS={
 'home':[
  ((1088,484,1292,570),'metal',0.75), # laptop lid
  ((854,527,937,591),'ceramic',0.77), # upright coffee cup
  ((1668,468,1767,539),'fabric',0.73), # embroidered coat
 ],
 'support':[
  ((814,382,1029,453),'metal',0.73),
  ((1533,426,1618,509),'fabric',0.72),
  ((1855,437,1955,505),'ceramic',0.75),
 ],
 'pricing':[
  ((1819,435,1920,505),'fabric',0.70),
  ((1939,523,2019,584),'ceramic',0.75),
 ],
}

def retouch_printed_logo(im, box, material, opacity):
    """Change only pre-existing logo pixels: simulate ink/embroidery under the
    material lighting and grain, with no new digital overlay text/logos."""
    a=np.asarray(im.convert('RGB')).copy()
    x0,y0,x1,y1=box
    roi=a[y0:y1,x0:x1].copy()
    h,w=roi.shape[:2]
    if h<10 or w<10: return im
    hsv=cv2.cvtColor(roi, cv2.COLOR_RGB2HSV)
    lum=cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY).astype('float32')
    R,G,B=[roi[:,:,i].astype('float32') for i in range(3)]
    if material=='metal':
        # Bright white and cyan branding on a matte-grey aluminium panel.
        colored=(B>R+18)&(G>R+3)&(B>120)
        white=(R>195)&(G>195)&(B>193)
        mask=(colored|white).astype('uint8')*255
    elif material=='ceramic':
        # Dark and blue print on off-white glazed porcelain.
        saturated=(B>R+18)&(G>R+8)&(B>110)
        dark=(lum<131)&(B>R*0.75)
        mask=(saturated|dark).astype('uint8')*255
    else:
        # Navy and cyan thread on illuminated white fabric.  Avoid lighting
        # gradients and use only the actual darker chromatic lettering.
        cool=(B>R+12)&(G>R+3)&(B>100)
        navy=(lum<102)&(B>R*0.80)
        mask=(cool|navy).astype('uint8')*255
    # Limit optical effect to logo strokes; smooth edges without a rectangular patch.
    kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3))
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,kernel)
    if np.count_nonzero(mask)<10:return im
    # Reconstruct underlying material local illumination beneath printed strokes.
    under=cv2.inpaint(roi,mask,3,cv2.INPAINT_TELEA).astype('float32')
    detail=under-cv2.GaussianBlur(under,(0,0),sigmaX=3.0)
    # Reintroduce surface grain and variable ink density, controlling opacity
    # via local relief rather than replacing the source graphic entirely.
    glow=cv2.GaussianBlur(cv2.cvtColor(under.astype('uint8'),cv2.COLOR_RGB2GRAY).astype('float32'),(0,0),sigmaX=10)
    illumination=np.clip(.88+.22*(glow-glow.mean())/(glow.std()+1),.73,1.07)
    effective=(opacity*illumination)[:,:,None]
    source=roi.astype('float32')
    printed=under*(1-effective)+source*effective+detail*.25
    # Soft roughness on fabric and an ever-so-subtle reflective curve on mugs.
    if material=='fabric':printed+=detail*.27
    if material=='ceramic':
        theta=(np.arange(w)[None,:]-w*.5)/(w*.5)
        printed*=np.clip(1-.065*theta**2,.90,1)[...,None]
    alpha=cv2.GaussianBlur(mask.astype('float32')/255,(0,0),sigmaX=.75)[...,None]
    a[y0:y1,x0:x1]=np.clip(source*(1-alpha)+printed*alpha,0,255).astype('uint8')
    return Image.fromarray(a,'RGB')

def get_font(size, bold=False):
    candidates=[
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ]
    for p in candidates:
        if Path(p).exists():return ImageFont.truetype(p,size)
    return ImageFont.load_default()

def draw_illustration(draw, typ, cx, cy, tint=(168,253,254,255)):
    # Individual app illustrations; same bright cyan-white outlined language
    # as the existing transparent holographic panels.
    line=(212,250,255,252); cyan=(45,236,237,255); dark=(12,58,85,180)
    if typ=='DuckNote':
        draw.rounded_rectangle((cx-27,cy-31,cx+26,cy+31),radius=5,outline=line,width=4,fill=(9,74,108,80))
        for y in [-19,-7,5,17]:draw.line((cx-14,cy+y,cx+15,cy+y),fill=cyan,width=3)
        for y in [-25,-15,-5,5,15,25]:draw.ellipse((cx-31,cy+y-2,cx-25,cy+y+4),outline=line,width=2)
    elif typ=='LabDuck':
        pts=[(cx-9,cy-29),(cx+9,cy-29),(cx+9,cy-7),(cx+26,cy+24),(cx+23,cy+29),(cx-23,cy+29),(cx-26,cy+24),(cx-9,cy-7)]
        draw.line(pts+[pts[0]],fill=line,width=4,joint='curve')
        draw.polygon([(cx-19,cy+17),(cx+20,cy+17),(cx+24,cy+27),(cx-24,cy+27)],fill=(20,220,233,165))
        draw.ellipse((cx-5,cy+10,cx+1,cy+16),fill=line)
        draw.ellipse((cx+10,cy+5,cx+15,cy+10),fill=cyan)
    elif typ=='DataDuck':
        draw.rounded_rectangle((cx-30,cy-30,cx+30,cy+30),radius=4,outline=line,width=3,fill=(12,75,109,77))
        draw.line((cx-22,cy+19,cx-22,cy-20),fill=line,width=2)
        draw.line((cx-22,cy+19,cx+23,cy+19),fill=line,width=2)
        draw.line([(cx-17,cy+3),(cx-5,cy-8),(cx+5,cy-1),(cx+19,cy-18)],fill=cyan,width=4,joint='curve')
        for px,py in [(-17,3),(-5,-8),(5,-1),(19,-18)]:draw.ellipse((cx+px-3,cy+py-3,cx+px+3,cy+py+3),fill=line)
    else: # DuckMan: managed / approved document folder
        draw.rounded_rectangle((cx-30,cy-18,cx+30,cy+26),radius=4,outline=line,width=4,fill=(9,74,108,85))
        draw.line([(cx-30,cy-18),(cx-30,cy-28),(cx-4,cy-28),(cx+5,cy-18)],fill=line,width=3)
        draw.line([(cx-14,cy+5),(cx-3,cy+15),(cx+17,cy-5)],fill=cyan,width=5,joint='curve')

def repair_holograms_home(im):
    # Restore ONLY the upper transparent data-widget region from the current
    # photo before drawing the four core-app holograms. The duck, laptop and
    # entire office scene remain sourced from original pixels.
    a=np.asarray(im.convert('RGB')).copy()
    h,w=a.shape[:2]
    # Old floating panels and their glow are inside this coarse mask.
    # Inpainting is intentionally bounded to windows above the laptop.
    mask=np.zeros((h,w),dtype=np.uint8)
    for (x0,y0,x1,y1) in [(948,62,1188,267),(1196,123,1393,285),(939,260,1295,414)]:
        cv2.rectangle(mask,(x0,y0),(x1,y1),255,-1)
    # Restore window glass/window mullions and atmosphere from bordering area,
    # then blur subtly to match depth of field behind the holograms.
    area=(925,50,1403,421)
    x0,y0,x1,y1=area
    roi=a[y0:y1,x0:x1].copy(); sm=mask[y0:y1,x0:x1].copy()
    restored=cv2.inpaint(roi,sm,20,cv2.INPAINT_TELEA)
    # Inpainted area is behind translucent glass and thus need not be hyper-sharp.
    restored=cv2.GaussianBlur(restored,(0,0),sigmaX=2.5)
    a[y0:y1,x0:x1]=np.where(sm[:,:,None]>0,restored,roi)
    img=Image.fromarray(a,'RGB').convert('RGBA')
    blur_glow=Image.new('RGBA',img.size,(0,0,0,0))
    gg=ImageDraw.Draw(blur_glow,'RGBA')
    ink=Image.new('RGBA',img.size,(0,0,0,0))
    draw=ImageDraw.Draw(ink,'RGBA')
    panels=[
        ('DuckNote',968,91),('LabDuck',1180,91),
        ('DataDuck',968,250),('DuckMan',1180,250),
    ]
    for title,x,y in panels:
        # 166x138 holographic rectangles; user wanted four analogous squares.
        x1,y1=x+167,y+137
        gg.rounded_rectangle((x-3,y-3,x1+3,y1+3),radius=13,outline=(0,244,251,180),width=8)
        draw.rounded_rectangle((x,y,x1,y1),radius=10,fill=(6,70,107,155),outline=(126,248,255,225),width=2)
        draw.line((x+13,y+12,x+65,y+12),fill=(213,253,255,105),width=2)
        draw.ellipse((x+9,y+10,x+15,y+16),fill=(167,250,255,220))
        draw_illustration(draw,title,x+83,y+58)
        textb=draw.textbbox((0,0),title,font=get_font(20,True))
        tw=textb[2]-textb[0]
        draw.text((x+(167-tw)//2,y+102),title,font=get_font(20,True),fill=(218,255,255,240),stroke_width=0)
    img=Image.alpha_composite(img,blur_glow.filter(ImageFilter.GaussianBlur(12)))
    img=Image.alpha_composite(img,ink)
    return img.convert('RGB')

def run():
    for name,oldfile in FNS.items():
        src=ROOT/oldfile
        if not src.exists():raise FileNotFoundError(src)
        im=Image.open(src).convert('RGB')
        if im.size!=(2172,724):raise ValueError(f'Unexpected size for {src}: {im.size}')
        if name=='home':im=repair_holograms_home(im)
        for box,material,opacity in PRINT_REGIONS[name]:
            im=retouch_printed_logo(im,box,material,opacity)
        output=ROOT/OUT[name]
        im.save(output,'WEBP',quality=91,method=6)
        print(f'Retouched EXISTING {oldfile} -> {OUT[name]} ({im.width}x{im.height}, {output.stat().st_size:,} bytes)')
    # Update the website only after all three edited image files have been written.
    pages={'home':'index.html','support':'support.html','pricing':'pricing.html'}
    for key,html_name in pages.items():
        page=ROOT.parent/html_name
        text=page.read_text(encoding='utf-8')
        before='assets/'+FNS[key]
        after='assets/'+OUT[key]
        if text.count(before)!=1:
            raise ValueError(f'Expected exactly one existing banner reference in {page}: {before}, got {text.count(before)}')
        page.write_text(text.replace(before,after),encoding='utf-8')
        print(f'Updated website banner reference: {page}')
if __name__=='__main__':run()