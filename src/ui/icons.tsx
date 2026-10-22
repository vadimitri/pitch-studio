// Icons: Phosphor (MIT, phosphoricons.com), regular weight ≈ Neo's 1.5 px line. One place to swap the set.
import {
  ArrowCounterClockwise, ArrowLeft, ArrowRight, ArrowSquareOut, ArrowUp, Check, Columns, DownloadSimple, Eye, EyeSlash, GithubLogo,
  HandPalm, HandPeace, Info, LinkSimple, LockSimple, Microphone, PaperPlaneTilt, Pause, Play, SlidersHorizontal,
  ThumbsDown, ThumbsUp, Trash, VideoCamera, X, type IconProps,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";

const mk = (C: ComponentType<IconProps>, weight: IconProps["weight"] = "regular") =>
  (p: IconProps) => <C size={20} weight={weight} aria-hidden {...p} />;

export const IconPlay = mk(Play, "fill");
export const IconPause = mk(Pause, "fill");
export const IconArrowRight = mk(ArrowRight);
export const IconArrowLeft = mk(ArrowLeft);
export const IconArrowUp = mk(ArrowUp, "bold");
export const IconClose = mk(X);
export const IconDownload = mk(DownloadSimple);
export const IconTrash = mk(Trash);
export const IconCompare = mk(Columns);
export const IconAgain = mk(ArrowCounterClockwise);
export const IconCheck = mk(Check, "bold");
export const IconLock = mk(LockSimple);
export const IconCamera = mk(VideoCamera);
export const IconMic = mk(Microphone);
export const IconExternal = mk(ArrowSquareOut);
export const IconGithub = mk(GithubLogo);
export const IconShare = mk(PaperPlaneTilt);
export const IconLink = mk(LinkSimple);
export const IconInfo = mk(Info);
export const IconSliders = mk(SlidersHorizontal);
export const IconEye = mk(Eye);
export const IconEyeSlash = mk(EyeSlash);
// hands for gesture hints
export const IconPalm = mk(HandPalm);
export const IconThumbUp = mk(ThumbsUp);
export const IconThumbDown = mk(ThumbsDown);
export const IconVictory = mk(HandPeace);
