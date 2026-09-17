// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/config.js — AI 레이어 설정.
//
// AI_ENDPOINT 가 빈 문자열("")이면 데모(mock) 모드로 동작합니다.
//   → 브라우저 안에서 recommender.js 를 그대로 재사용하는 결정론적 한국어 MockProvider.
// 실제 Claude 를 쓰려면 server/ 프록시를 띄운 뒤 그 주소를 여기에 넣으세요.
//   예: export const AI_ENDPOINT = "http://localhost:8788/api/ai";
//
// ⚠️ 브라우저·저장소에는 절대 API 키를 두지 않습니다.
//    키는 오직 server/ (백엔드)에서 ANTHROPIC_API_KEY 환경변수로만 사용합니다.
export const AI_ENDPOINT = "";
