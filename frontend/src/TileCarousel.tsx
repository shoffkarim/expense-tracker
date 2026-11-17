import { Children, useLayoutEffect, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionIcon } from '@mantine/core';
import { Swiper, SwiperSlide } from 'swiper/react';
import { A11y, FreeMode, Mousewheel } from 'swiper/modules';
import type { Swiper as SwiperInstance } from 'swiper';

export function TileCarousel({ children, accounts = false }: { children: ReactNode; accounts?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const swiper = useRef<SwiperInstance | null>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [page, setPage] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: false });
  const columns = width <= 650 ? 2 : width <= 950 ? (accounts ? 3 : 4) : (accounts ? 5 : 8);
  const capacity = columns * (accounts ? 2 : 4);
  const items = Children.toArray(children);
  const count = Math.ceil(items.length / capacity);
  const previousCapacity = useRef(capacity);
  const speed = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300;
  const sync = (instance: SwiperInstance) => {
    setPage(instance.activeIndex);
    setEdges(old => old.start === instance.isBeginning && old.end === instance.isEnd
      ? old : { start: instance.isBeginning, end: instance.isEnd });
  };

  useEffect(() => {
    const resize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useLayoutEffect(() => {
    const instance = swiper.current;
    if (!instance || instance.destroyed) return;
    const next = Math.max(0, Math.min(count - 1, Math.floor(instance.activeIndex * previousCapacity.current / capacity)));
    previousCapacity.current = capacity;
    instance.update();
    instance.slideTo(next, 0);
  }, [capacity, count]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const cards = Array.from(el.querySelectorAll<HTMLElement>('.sortable-card'));
      cards.forEach(card => { card.style.minHeight = ''; });
      const height = Math.max(0, ...cards.map(card => card.getBoundingClientRect().height));
      cards.forEach(card => { card.style.minHeight = `${height}px`; });
      swiper.current?.updateAutoHeight(speed());
    };
    measure();
    const observer = new ResizeObserver(measure);
    el.querySelectorAll('.tile-slide').forEach(slide => observer.observe(slide));
    return () => observer.disconnect();
  }, [children, columns]);

  // Only the carousel containing the dragged card pauses its swipe handling.
  useEffect(() => {
    let sorting = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let direction = 0;
    const start = (event: Event) => {
      const group = (event as CustomEvent<HTMLElement>).detail;
      if (!group?.contains(root.current)) return;
      sorting = true;
      if (swiper.current) {
        swiper.current.allowTouchMove = false;
        swiper.current.mousewheel.disable();
      }
    };
    const end = () => {
      if (!sorting) return;
      sorting = false;
      clearTimeout(timer);
      direction = 0;
      if (swiper.current && !swiper.current.destroyed) {
        swiper.current.allowTouchMove = true;
        swiper.current.mousewheel.enable();
      }
    };
    const move = (event: PointerEvent) => {
      if (!sorting || !root.current) return;
      const rect = root.current.getBoundingClientRect();
      const next = event.clientY < rect.top || event.clientY > rect.bottom ? 0
        : event.clientX < rect.left + 35 ? -1 : event.clientX > rect.right - 35 ? 1 : 0;
      if (next === direction) return;
      clearTimeout(timer);
      direction = next;
      if (next) timer = setTimeout(() => {
        const instance = swiper.current;
        if (instance) instance.slideTo(instance.activeIndex + next, speed());
        direction = 0;
      }, 600);
    };
    window.addEventListener('tile-sort-start', start);
    window.addEventListener('tile-sort-end', end);
    window.addEventListener('pointermove', move);
    return () => {
      end();
      window.removeEventListener('tile-sort-start', start);
      window.removeEventListener('tile-sort-end', end);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  return <div ref={root} className="tile-carousel" role="region" aria-roledescription="карусель">
    <Swiper modules={[FreeMode, Mousewheel, A11y]} slidesPerView={1} spaceBetween={16}
      freeMode={{ enabled: true, sticky: false, momentum: true, momentumBounce: false }}
      mousewheel={{ releaseOnEdges: true }} autoHeight speed={300} threshold={5}
      touchStartPreventDefault={false} noSwipingSelector="button,input,select,textarea"
      onSwiper={instance => { swiper.current = instance; sync(instance); }}
      onProgress={sync} onSlideChange={instance => { sync(instance); instance.updateAutoHeight(speed()); }}>
      {Array.from({ length: count }, (_,i) => <SwiperSlide key={i}>
        <div className="tile-slide" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}>
          {items.slice(i * capacity, (i + 1) * capacity)}
        </div>
      </SwiperSlide>)}
    </Swiper>
    {count > 1 && <>
      <ActionIcon className="carousel-arrow previous" aria-label="Предыдущий слайд" disabled={edges.start} onClick={() => swiper.current?.slidePrev(speed())}>‹</ActionIcon>
      <ActionIcon className="carousel-arrow next" aria-label="Следующий слайд" disabled={edges.end} onClick={() => swiper.current?.slideNext(speed())}>›</ActionIcon>
      <div className="carousel-counter" aria-live="polite">{page + 1} / {count}</div>
    </>}
  </div>;
}
