import Image from "next/image";

export interface FanPic {
  id: string;
  src: string;
  color: string;
}

/** Сколько кадров веером и на сколько градусов раскрывается веер между соседними */
const FAN_MAX = 4;
const FAN_STEP = 6;
const FAN_STEP_HOVER = 9;
/** Сдвиг соседних кадров в сторону, % ширины самого кадра */
const FAN_SPREAD = 43;
const FAN_SPREAD_HOVER = 50;

/** Кадры веером одного формата 3:4 (горизонтальные обрезаются). Веер раскрывается шире, когда курсор
    над предком с классом group (карточка папки) */
export default function PhotoFan({ pics }: { pics: FanPic[] }) {
  const fan = pics.slice(0, FAN_MAX);
  const mid = (fan.length - 1) / 2;

  return (
    <div
      className="relative aspect-[2/1] w-full"
      style={{ ["--step" as string]: FAN_STEP, ["--step-hover" as string]: FAN_STEP_HOVER, ["--spread" as string]: FAN_SPREAD, ["--spread-hover" as string]: FAN_SPREAD_HOVER }}
    >
      {fan.map((f, i) => (
        <div
          key={f.id}
          className="absolute bottom-[4%] left-1/2 aspect-[3/4] w-[34%] origin-bottom overflow-hidden rounded-[14px] shadow-[0_4px_14px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out [transform:translateX(calc(-50%+var(--k)*var(--spread)*1%))_rotate(calc(var(--k)*var(--step)*1deg))] group-hover:[transform:translateX(calc(-50%+var(--k)*var(--spread-hover)*1%))_rotate(calc(var(--k)*var(--step-hover)*1deg))]"
          style={{ ["--k" as string]: i - mid, zIndex: 10 - Math.round(Math.abs(i - mid)), backgroundColor: f.color }}
        >
          <Image src={f.src} alt="" fill unoptimized sizes="200px" className="object-cover" />
        </div>
      ))}
    </div>
  );
}
