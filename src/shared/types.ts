export type Vec3 = [number, number, number];
export interface Face {
  id: string;
  points: Vec3[];
  parent?: string;
  hinge?: [Vec3, Vec3];
  crease?: string;
}
export interface Crease {
  id: string;
  name: string;
  description: string;
  face: string;
  target: number;
}
export interface Paper {
  id: string;
  name: string;
  subtitle: string;
  size: number;
  faces: Face[];
  creases: Crease[];
}
export interface Step {
  id: string;
  title: string;
  note: string;
  angles: Record<string, number>;
  duration: number;
}
export interface View {
  yaw: number;
  pitch: number;
  zoom: number;
  grid: boolean;
  wire: boolean;
  /** 透视纸层模式：半透明显示所有纸面，允许点选被遮挡的内部折痕。 */
  xray: boolean;
}
export interface Document {
  paper: Paper;
  front: string;
  back: string;
  texture: string;
  selected: string;
  angles: Record<string, number>;
  directions: Record<string, number>;
  steps: Step[];
  step: number;
  playing: boolean;
  speed: number;
  view: View;
}
export interface PoseFace {
  id: string;
  points: Vec3[];
  normal: Vec3;
}
